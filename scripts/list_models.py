"""List the models visible to our Token Factory key (ids only).

    uv run python scripts/list_models.py [--base-url URL] [--filter nemotron]
"""
import argparse
import sys

from openai import OpenAI

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
from moby.config import get_settings  # noqa: E402


def main() -> int:
    s = get_settings()
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default=s.token_factory_base_url)
    p.add_argument("--filter", default="")
    args = p.parse_args()

    if s.token_factory_api_key is None:
        print("N_FACTORY_ACC_KEY is not set", file=sys.stderr)
        return 1
    client = OpenAI(api_key=s.token_factory_api_key.get_secret_value(), base_url=args.base_url, timeout=30)
    ids = sorted(m.id for m in client.models.list())
    wanted = [i for i in ids if args.filter.lower() in i.lower()]
    print(f"{args.base_url}: {len(ids)} models, {len(wanted)} matching {args.filter!r}")
    for i in wanted:
        print(" ", i)
    return 0


if __name__ == "__main__":
    sys.exit(main())
