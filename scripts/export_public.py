"""Build the public subset of this (private) repository into a directory.

    uv run python scripts/export_public.py OUT_DIR

1. Copies every git-tracked file matched by public/allowlist.txt.
2. Overlays public/overlay/ (public-only README, contributing guide, CI, templates).
3. Refuses (exit 1) if any published file contains a forbidden pattern: private
   hosts, model endpoints, project ids, keys, internal routes.

Used by .github/workflows/publish-public.yml; run it locally to preview.
"""
import fnmatch
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST = ROOT / "public" / "allowlist.txt"
OVERLAY = ROOT / "public" / "overlay"

# Never publish files matching these, even if the allowlist would.
DENY_PATHS = ["google-services.json", "GoogleService-Info.plist", ".env*", "*.jks", "*.keystore",
              "*adminsdk*.json", "db/*", "deploy/*", "moby/*", "docs/*", "*.sql"]

# Content that must never appear in the public repo.
FORBIDDEN = [
    (r"tokenfactory\.[a-z.]*nebius", "model endpoint"),
    (r"api\.nebius\.cloud|\.nebius\.cloud", "infrastructure host"),
    (r"moby-52b4c", "Firebase project id"),
    (r"AIza[0-9A-Za-z_\-]{30,}", "Google API key"),
    (r"/internal/v1", "internal API route"),
    (r"MOBY_SERVICE_TOKEN|MOBY_REPORTER_SALT|N_FACTORY_ACC_KEY", "server secret name"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key"),
    (r"project-[a-z0-9]{20}|tenant-[a-z0-9]{18}|serviceaccount-[a-z0-9]{18}", "cloud resource id"),
]


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [line for line in out.splitlines() if line]


def allowlist() -> list[str]:
    return [line.strip() for line in ALLOWLIST.read_text().splitlines()
            if line.strip() and not line.startswith("#")]


def matches(path: str, pattern: str) -> bool:
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-3] + "/")
    return fnmatch.fnmatch(path, pattern)


def main(out_dir: str) -> int:
    out = Path(out_dir).resolve()
    if out.exists():
        for child in out.iterdir():          # keep out/.git when re-exporting into a checkout
            if child.name != ".git":
                shutil.rmtree(child) if child.is_dir() else child.unlink()
    out.mkdir(parents=True, exist_ok=True)

    patterns = allowlist()
    published: list[Path] = []
    for path in tracked_files():
        if not any(matches(path, p) for p in patterns):
            continue
        if any(fnmatch.fnmatch(path, d) or fnmatch.fnmatch(Path(path).name, d) for d in DENY_PATHS):
            print(f"denied (never public): {path}", file=sys.stderr)
            continue
        dest = out / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / path, dest)
        published.append(dest)
    for src in OVERLAY.rglob("*"):
        if src.is_file():
            dest = out / src.relative_to(OVERLAY)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            published.append(dest)

    problems = []
    for f in published:
        try:
            text = f.read_text(errors="ignore")
        except OSError:
            continue
        for pattern, what in FORBIDDEN:
            if re.search(pattern, text):
                problems.append(f"{f.relative_to(out)}: contains a {what} ({pattern})")
    if problems:
        print("Refusing to publish:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    print(f"exported {len(published)} files to {out}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
