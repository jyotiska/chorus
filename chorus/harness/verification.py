"""Independent, deterministic checks for the five fixed benchmark instances."""
import json
import math
from fractions import Fraction
from markdown_it import MarkdownIt
from chorus.harness.models import Problem, Verification


def validate(value, schema, path="answer"):
    kind = schema["type"]
    if kind == "object":
        if not isinstance(value, dict) or set(value) != set(schema["required"]):
            raise ValueError(f"{path}: expected exactly {', '.join(schema['required'])}.")
        for key, spec in schema["properties"].items():
            validate(value[key], spec, f"{path}.{key}")
    elif kind == "array":
        if not isinstance(value, list) or len(value) > 100:
            raise ValueError(f"{path}: expected an array of at most 100 entries.")
        for item in value:
            validate(item, schema["items"], path)
    elif kind == "integer":
        if type(value) is not int:
            raise ValueError(f"{path}: expected an integer.")
    elif kind == "number":
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError(f"{path}: expected a finite number.")
    elif kind == "string" and not isinstance(value, str):
        raise ValueError(f"{path}: expected text.")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: choose one of {schema['enum']}.")
    if kind in {"number", "integer"} and ("minimum" in schema and value < schema["minimum"] or "maximum" in schema and value > schema["maximum"]):
        raise ValueError(f"{path}: outside the permitted numeric range.")


def check(problem_id: str, a: dict) -> None:
    def require(condition, message):
        if not condition:
            raise ValueError(message)
    if problem_id == "deployment-schedule":
        jobs = {"A": (3, ()), "B": (2, ()), "C": (4, ("A",)), "D": (2, ("A",)), "E": (3, ("B", "C")), "F": (1, ("D", "E"))}
        rows = {r["id"]: r for r in a["jobs"]}
        require(len(a["jobs"]) == 6 and set(rows) == set(jobs), "Each job A–F must occur exactly once.")
        for key, (duration, deps) in jobs.items():
            row = rows[key]
            require(row["worker"] in (1, 2) and row["start"] >= 0 and row["end"] - row["start"] == duration, f"Invalid duration, worker, or start for {key}.")
            require(all(rows[d]["end"] <= row["start"] for d in deps), f"Prerequisites fail for {key}.")
        for worker in (1, 2):
            ordered = sorted((r for r in rows.values() if r["worker"] == worker), key=lambda r: r["start"])
            require(all(x["end"] <= y["start"] for x, y in zip(ordered, ordered[1:])), "Worker jobs overlap.")
        makespan = max(r["end"] for r in rows.values())
        # A→C→E→F is an independently computed lower bound; the submitted
        # feasible schedule must attain it, rather than match a stored schedule.
        lower_bound = sum(jobs[j][0] for j in ("A", "C", "E", "F"))
        require(a["makespan"] == makespan == lower_bound, "The schedule must attain the optimal 11-minute makespan.")
    elif problem_id == "transaction-ledger":
        rows = [("t1", "A", "capture", 12000), ("t2", "A", "capture", 8000), ("t2", "A", "capture", 8000), ("t3", "A", "refund", 3000), ("t4", "B", "capture", 20000), ("t5", "B", "refund", 5000), ("t6", "A", "pending", 9000), ("t7", "B", "failed", 7000), ("t8", "C", "capture", 4000), ("t9", "C", "refund", 4000)]
        seen, duplicates, balances = set(), set(), dict.fromkeys("ABC", 0)
        for key, account, kind, cents in rows:
            if key in seen:
                duplicates.add(key)
                continue
            seen.add(key)
            balances[account] += cents if kind == "capture" else -cents if kind == "refund" else 0
        require(a["accounts"] == balances and a["total"] == sum(balances.values()), "Net receipts or total do not reconcile.")
        require(len(a["duplicateIds"]) == len(duplicates) and set(a["duplicateIds"]) == duplicates, "Incorrect duplicate transaction IDs.")
    elif problem_id == "reservoir-mixture":
        low, middle, high = a["lowLiters"], a["middleLiters"], a["highLiters"]
        require(min(low, middle, high) >= 0, "Volumes must be nonnegative.")
        require(abs(low + middle + high - 30) <= 1e-6 and abs(a["totalLiters"] - 30) <= 1e-6, "Volume must total 30 liters.")
        require(abs(high - 2 * low) <= 1e-6, "The high-concentration volume must be twice the low volume.")
        actual = (low * .1 + middle * .3 + high * .5) / 30
        require(abs(actual - .34) <= 1e-9 and abs(a["concentration"] - actual) <= 1e-9, "Solute balance or concentration fails.")
    elif problem_id == "production-mix":
        x, y = a["x"], a["y"]
        machine, finishing, contribution = 3 * x + 2 * y, x + 2 * y, 50 * x + 40 * y
        require(0 <= x <= 30 and 0 <= y <= 35 and machine <= 120 and finishing <= 80, "Production violates resource or demand constraints.")
        optimum = max(50 * u + 40 * v for u in range(31) for v in range(36) if 3 * u + 2 * v <= 120 and u + 2 * v <= 80)
        require(a["machineHours"] == machine and a["finishingHours"] == finishing and a["contribution"] == contribution == optimum, "Totals or optimal contribution are incorrect.")
    elif problem_id == "process-inference":
        evidence = Fraction(3, 5) * Fraction(4, 5) ** 2 + Fraction(2, 5) * Fraction(3, 10) ** 2
        posterior = Fraction(3, 5) * Fraction(4, 5) ** 2 / evidence
        require(abs(a["probabilityTwoSuccesses"] - float(evidence)) <= 1e-9 and abs(a["posteriorP"] - float(posterior)) <= 1e-9, "Evidence probability or posterior is incorrect.")
    else:
        raise RuntimeError("No verifier is registered for this problem.")


def verify(problem: Problem, canvas: str, version: int) -> Verification:
    try:
        blocks = [t.content for t in MarkdownIt().parse(canvas) if t.type == "fence" and t.info.strip() == "solution"]
        if len(blocks) != 1:
            raise ValueError("Include exactly one fenced solution block containing the JSON answer.")
        def pairs(items):
            out = {}
            for key, value in items:
                if key in out:
                    raise ValueError("Duplicate answer keys are not allowed.")
                out[key] = value
            return out
        answer = json.loads(blocks[0], object_pairs_hook=pairs)
        validate(answer, problem.answerSchema)
        check(problem.id, answer)
        return Verification(status="correct", checks=["Answer format, constraints, and expected outcome passed."], canvasVersion=version)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        return Verification(status="incorrect", checks=[str(error)[:1000]], canvasVersion=version)
    except RuntimeError:
        return Verification(status="unavailable", checks=["The configured verifier is unavailable."], canvasVersion=version)
