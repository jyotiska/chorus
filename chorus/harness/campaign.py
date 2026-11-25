"""Durable sequential DeepSWE campaigns. The engine owns scheduling and scoring."""
import asyncio
import logging
import random
from uuid import uuid4

from chorus.harness import deepswe, public_checks
from chorus.harness.accounting import usage_report
from chorus.harness.models import (
    CampaignScore, CampaignTrial, DeepSWECampaign, DeepSWECampaignRequest, DeepSWEComparison, HarnessCommand, Persona,
    PublicCheckPin,
)
from chorus.services.errors import ChorusError
from chorus.storage import now


async def checked_profile(task=None):
    profile = await asyncio.to_thread(deepswe.resolve_profile, task)
    await asyncio.to_thread(profile.check_docker)
    return profile


def scores(conditions, repeats, trials):
    outcomes = {condition.name: {} for condition in conditions}
    for trial in trials:
        if trial.reward is not None:
            outcomes[trial.condition][trial.repeat] = trial.reward
    baseline = outcomes[conditions[0].name]
    rows = []
    for name, rewards in outcomes.items():
        paired = rewards.keys() & baseline.keys()
        passed = sum(rewards.values())
        rows.append(CampaignScore(condition=name, passed=passed, graded=len(rewards), planned=repeats,
                                  ratePercent=100 * passed / len(rewards) if rewards else None,
                                  pairedCount=len(paired), deltaPoints=(
                                      100 * sum(rewards[i] - baseline[i] for i in paired) / len(paired) if paired else None)))
    return rows


class Campaigns:
    def __init__(self, service):
        self.service = service
        self.repo = service.repo
        self.jobs = {}
        for cid in self.repo.campaign_ids():
            if self.repo.campaign(cid)["status"] == "running":
                self.repo.set_campaign_status(cid, "paused", "Engine restarted. Resume the campaign to continue.")

    async def create(self, manifest):
        cid = manifest.requestId
        try:
            existing = self.repo.campaign(cid)
        except ChorusError as error:
            if error.code != "NOT_FOUND":
                raise
        else:
            if DeepSWECampaignRequest.model_validate(existing["manifest"]) != manifest:
                raise ChorusError("CONFLICT", "Choose a fresh campaign ID for different settings.", 409)
            return self.report(cid)
        profile = await checked_profile(manifest.task)
        checks = {condition.publicChecks for condition in manifest.conditions if condition.publicChecks}
        if len(checks) > 1:
            raise ChorusError("INVALID_REQUEST", "Use the configured public check profile for all enabled conditions.", 400)
        check_profile = public_checks.resolve_profile(next(iter(checks), None))
        profile.validate_public_checks(check_profile)
        rosters = [[p.model_dump() for p in self.service.experiments.deepswe_roster(c)] for c in manifest.conditions]
        rng = random.Random(manifest.seed)
        trials = []
        for repeat in range(1, manifest.repeats + 1):
            order = list(range(len(rosters)))
            rng.shuffle(order)
            trials.extend({"condition": i, "repeat": repeat, "sessionId": None} for i in order)
        created = self.repo.create_campaign(cid, dict(manifest=manifest.model_dump(), rosters=rosters, trials=trials,
                                                      status="running", createdAt=now(), error="",
                                                      engineVersion=deepswe.TEAM_VERSION, promptVersion=deepswe.TEAM_PROMPT,
                                                      publicCheckProfile=check_profile.model_dump(mode="json") if check_profile else None,
                                                      publicCheckVersion=public_checks.VERSION if check_profile else None))
        if created:
            self.jobs[cid] = asyncio.create_task(self.run(cid, profile))
        return self.report(cid)

    def report(self, cid):
        data = self.repo.campaign(cid)
        manifest = DeepSWECampaignRequest.model_validate(data["manifest"])
        trials = []
        for slot in data["trials"]:
            sid = slot["sessionId"]
            snapshot = self.repo.get(sid) if sid else None
            bench = snapshot.experiment.deepswe if snapshot else None
            usage = usage_report(self.repo, sid) if snapshot and snapshot.status in {"completed", "verify_failed", "killed"} else None
            trials.append(CampaignTrial(condition=manifest.conditions[slot["condition"]].name, repeat=slot["repeat"],
                                        sessionId=sid, status=snapshot.status if snapshot else ("cancelled" if data["status"] == "cancelled" else "queued"),
                                        reward=bench.result.reward if bench and bench.result else None,
                                        calls=bench.callsReserved if bench else 0, usage=usage.total if usage else None,
                                        wallTimeMs=usage.wallTimeMs if usage else None))
        return DeepSWECampaign(id=cid, manifest=manifest, status=data["status"], error=data["error"], trials=trials,
                               scores=scores(manifest.conditions, manifest.repeats, trials),
                               engineVersion=data["engineVersion"], promptVersion=data["promptVersion"],
                               publicCheckProfile=data.get("publicCheckProfile"),
                               callCeiling=manifest.repeats * sum(c.callLimit for c in manifest.conditions))

    def compare(self, cid, other_id, candidate_name, baseline_name):
        candidate = self.report(cid)
        baseline = self.report(other_id)
        if candidate.manifest.task != baseline.manifest.task:
            raise ChorusError("VERSION_MISMATCH", "Choose campaigns with matching task, image and verifier pins.", 409)

        def select_condition(report, name):
            for condition in report.manifest.conditions:
                if condition.name == name:
                    return condition
            raise ChorusError("INVALID_REQUEST", "Choose a condition recorded in this campaign.", 400)

        selected = select_condition(candidate, candidate_name)
        reference = select_condition(baseline, baseline_name)
        changed = [label for field, label in (("model", "Team model"), ("slots", "Worker profiles or models"),
                                               ("callLimit", "Call limit"), ("solvingSeconds", "Solving deadline"),
                                               ("publicChecks", "Public checks"))
                   if getattr(selected, field) != getattr(reference, field)]
        if (candidate.engineVersion, candidate.promptVersion) != (baseline.engineVersion, baseline.promptVersion):
            changed.append("Engine or prompt version")
        if self.repo.campaign(cid)["rosters"][candidate.manifest.conditions.index(selected)] != (
                self.repo.campaign(other_id)["rosters"][baseline.manifest.conditions.index(reference)]):
            changed.append("Effective roster")
        def outcomes(report, name):
            return {t.repeat: t.reward for t in report.trials if t.condition == name and t.reward is not None}
        a, b = outcomes(baseline, baseline_name), outcomes(candidate, candidate_name)
        pairs = a.keys() & b.keys()
        wins = sum(b[i] > a[i] for i in pairs)
        losses = sum(b[i] < a[i] for i in pairs)
        return DeepSWEComparison(
            baseline=baseline_name, candidate=candidate_name, paired=len(pairs), wins=wins, losses=losses,
            ties=len(pairs) - wins - losses, baselinePlanned=baseline.manifest.repeats, candidatePlanned=candidate.manifest.repeats,
            baselinePercent=100 * sum(a[i] for i in pairs) / len(pairs) if pairs else None,
            candidatePercent=100 * sum(b[i] for i in pairs) / len(pairs) if pairs else None,
            deltaPoints=100 * (wins - losses) / len(pairs) if pairs else None, changedSettings=changed,
        )

    def command(self, state, action):
        return self.service.command(state.id, HarnessCommand(action=action, expectedRevision=state.revision,
                                                             commandId=str(uuid4())))

    async def run(self, cid, profile, *, resume=False):
        try:
            data = self.repo.campaign(cid)
            manifest = DeepSWECampaignRequest.model_validate(data["manifest"])
            check_profile = PublicCheckPin.model_validate(data["publicCheckProfile"]) if data.get("publicCheckProfile") else None
            for index, trial in enumerate(data["trials"]):
                if trial["sessionId"]:
                    state = self.repo.get(trial["sessionId"])
                else:
                    condition = trial["condition"]
                    frozen = [Persona.model_validate(p) for p in data["rosters"][condition]]
                    state = self.service.experiments.create_deepswe(profile, manifest.conditions[condition],
                                                                    roster=frozen, campaign_slot=(cid, index), check_profile=check_profile)
                if state.status == "ready":
                    state = self.command(state, "start")
                elif resume and state.status == "paused":
                    state = self.command(state, "resume")
                while state.status in {"running", "reviewing", "stopping"}:
                    await asyncio.sleep(0.5)
                    state = self.repo.get(state.id)
                if state.status == "paused":
                    self.repo.set_campaign_status(cid, "paused", state.error or "A trial needs attention.")
                    return
            self.repo.set_campaign_status(cid, "finished")
        except ChorusError as error:
            self.repo.set_campaign_status(cid, "paused", str(error))
        except Exception:
            logging.getLogger(__name__).exception("DeepSWE campaign interrupted")
            self.repo.set_campaign_status(cid, "paused", "Campaign interrupted. Reopen the trial and resume.")
        finally:
            self.jobs.pop(cid, None)

    async def control(self, cid, action):
        data = self.repo.campaign(cid)
        if action == "resume":
            if data["status"] != "paused":
                raise ChorusError("INVALID_STATE", "Only a paused campaign can resume.", 409)
            manifest = DeepSWECampaignRequest.model_validate(data["manifest"])
            profile = await checked_profile(manifest.task)
            if (data["engineVersion"], data["promptVersion"]) != (deepswe.TEAM_VERSION, deepswe.TEAM_PROMPT):
                raise ChorusError("VERSION_MISMATCH", "Restore the campaign engine and prompt versions.", 409)
            if data.get("publicCheckProfile") and data.get("publicCheckVersion") != public_checks.VERSION:
                raise ChorusError("VERSION_MISMATCH", "Restore the campaign's public check policy version.", 409)
            if self.repo.campaign(cid)["status"] != "paused":
                raise ChorusError("CONFLICT", "Campaign status changed.", 409)
            self.repo.set_campaign_status(cid, "running")
            self.jobs[cid] = asyncio.create_task(self.run(cid, profile, resume=True))
        else:
            if data["status"] not in {"running", "paused"}:
                raise ChorusError("INVALID_STATE", "This campaign has ended.", 409)
            self.repo.set_campaign_status(cid, "cancelled")
            job = self.jobs.get(cid)
            if job:
                job.cancel()
            for slot in data["trials"]:
                if slot["sessionId"]:
                    state = self.repo.get(slot["sessionId"])
                    if state.status in {"ready", "running", "reviewing", "paused"}:
                        self.command(state, "kill")
            if job:
                await asyncio.gather(job, return_exceptions=True)
                self.jobs.pop(cid, None)
        return self.report(cid)

    async def close(self):
        jobs = list(self.jobs.items())
        for cid, job in jobs:
            if self.repo.campaign(cid)["status"] == "running":
                self.repo.set_campaign_status(cid, "paused", "Engine stopped. Resume the campaign to continue.")
            job.cancel()
        await asyncio.gather(*(job for _, job in jobs), return_exceptions=True)
