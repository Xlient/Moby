"""Real-model check for step 7: does Nano read the example notes the way we decided?

    uv run --env-file .env python scripts/eval_structure.py            # all examples
    uv run --env-file .env python scripts/eval_structure.py winston    # names containing 'winston'

Calls Nemotron Nano through moby.graph.structure.extract_details (your prompt + schema) on
every example in tests/fixtures/structure_examples.json, and compares each field with the
expected answer. About 6 Nano calls, well under a cent. Never runs in normal CI: only here
or in the gated model-evals workflow. Use it to tune the field descriptions and the prompt:
change one thing, rerun, compare.

Exit code 1 if fewer than MIN_SCORE of the fields match (for the workflow).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))   # run as a file: make `moby` importable
EXAMPLES = json.loads((ROOT / "tests" / "fixtures" / "structure_examples.json").read_text())
MIN_SCORE = 0.8
DEPTH_TOLERANCE_M = 0.1      # "4 feet" → 1.22 m; small rounding differences are fine


def same(field: str, got, want) -> bool:
    if isinstance(want, float) and isinstance(got, (int, float)):
        return abs(got - want) <= DEPTH_TOLERANCE_M
    return got == want


def main() -> int:
    from moby.graph.structure import extract_details

    wanted = [e for e in EXAMPLES if not sys.argv[1:] or any(a in e["name"] for a in sys.argv[1:])]
    right = total = 0
    for ex in wanted:
        try:
            got = extract_details(ex["report"])
        except Exception as e:
            print(f"✗ {ex['name']}: the model call failed: {type(e).__name__}: {e}")
            total += len(ex["expected"])
            continue
        print(f"\n{ex['name']}  ({ex['why']})")
        print(f"  reasoning: {got.reasoning[:200]}")
        for field, want in ex["expected"].items():
            value = getattr(got, field)
            ok = same(field, value, want)
            right += ok
            total += 1
            print(f"  {'✓' if ok else '✗'} {field:18} got {value!r:22} want {want!r}")
    score = right / total if total else 0
    print(f"\n{right}/{total} fields right ({score:.0%}); pass mark {MIN_SCORE:.0%}")
    return 0 if score >= MIN_SCORE else 1


if __name__ == "__main__":
    sys.exit(main())
