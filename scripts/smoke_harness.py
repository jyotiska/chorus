"""Run a bounded live smoke session in an isolated, temporary database.

Writes metadata only; credentials and participant content are never exported.
"""
import argparse
import asyncio
import json
import tempfile
import time
from pathlib import Path
from uuid import uuid4
from dotenv import load_dotenv
from chorus.harness.service import HarnessService
from chorus.harness.models import HarnessCommand, HarnessConfig
from chorus.harness.accounting import usage_report
from chorus.storage import Store


async def run(model, timeout):
    with tempfile.TemporaryDirectory(prefix="chorus-harness-live-") as tmp:
        store = Store(str(Path(tmp) / "pilot.sqlite3"))
        svc = HarnessService(store)
        try:
            state = svc.create(HarnessConfig(problemId="production-mix", participantIds=["drew", "mika"], model=model, maxTurnsPerAgent=1))
            svc.command(state.id, HarnessCommand(commandId=str(uuid4()), action="start", expectedRevision=state.revision))
            started, previous = time.monotonic(), -1
            while time.monotonic() - started < timeout:
                state = svc.repo.get(state.id)
                calls = len(svc.repo.all(state.id, "call"))
                if calls != previous:
                    print(json.dumps({"model": model, "status": state.status, "calls": calls, "board": state.boardCount, "canvasVersion": state.canvasVersion}), flush=True)
                    previous = calls
                if state.status in {"completed", "paused", "stopped"}:
                    break
                await asyncio.sleep(1)
            state = svc.repo.get(state.id)
            return {"model": model, "status": state.status, "error": state.error, "verification": state.verification.model_dump() if state.verification else None, "reportComplete": state.report is not None, "boardPosts": state.boardCount, "canvasChanges": state.changeCount, "summaries": len(svc.repo.all(state.id, "summary")), "usage": usage_report(svc.repo, state.id).model_dump(), "callOutcomes": [{k: r.data.get(k) for k in ("phase", "outcome", "inputTokens", "outputTokens", "cachedTokens", "costSource")} for r in svc.repo.all(state.id, "call")], "diagnosticCategories": [{"assessment": r.data.get("assessmentKey"), "reason": r.data.get("reason", "")[:160]} for r in svc.repo.all(state.id, "diagnostic")]}
        finally:
            await svc.close()
            store.close()


async def main(args):
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    reports = []
    for model in args.models:
        result = await run(model, args.timeout)
        reports.append(result)
        print(json.dumps({"model": model, "finalStatus": result["status"], "reportComplete": result["reportComplete"], "error": result["error"]}), flush=True)
    document = json.loads(args.output.read_text()) if args.output.exists() else {"date": "2026-11-02", "scope": "Isolated two-agent one-turn smoke checks; not a quality benchmark."}
    document.setdefault("followupReports", []).extend(reports)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", nargs="+", help="Exact configured model IDs. Calls use configured credentials.")
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--output", type=Path, default=Path("results/live-harness-pilot.json"))
    asyncio.run(main(parser.parse_args()))
