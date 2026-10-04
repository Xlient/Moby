"""Grant (or revoke) the reviewer role: Firebase custom claim `reviewer: true`.

Needs a Firebase Admin service-account key for the project (never commit it):

    uv run --with firebase-admin python scripts/grant_reviewer.py someone@example.com \
        --key ./moby-52b4c-firebase-adminsdk-XXXX.json
    uv run --with firebase-admin python scripts/grant_reviewer.py someone@example.com --revoke --key ...

The user must sign out and back in (or wait up to an hour) for the new claim to reach
their ID token. Other custom claims on the account are preserved.
"""
import argparse
import sys

import firebase_admin
from firebase_admin import auth, credentials


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("email")
    p.add_argument("--key", required=True, help="path to the Firebase Admin service-account JSON")
    p.add_argument("--revoke", action="store_true", help="remove the reviewer role instead")
    args = p.parse_args()

    firebase_admin.initialize_app(credentials.Certificate(args.key))
    try:
        user = auth.get_user_by_email(args.email)
    except auth.UserNotFoundError:
        print(f"No Firebase account for {args.email}. They need to sign in to the app once first.", file=sys.stderr)
        return 1

    claims = dict(user.custom_claims or {})
    if args.revoke:
        claims.pop("reviewer", None)
    else:
        claims["reviewer"] = True
    auth.set_custom_user_claims(user.uid, claims or None)
    state = "no longer a reviewer" if args.revoke else "now a reviewer"
    print(f"{args.email} is {state}. They need to sign out and back in for it to take effect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
