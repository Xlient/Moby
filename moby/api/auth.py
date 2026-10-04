"""Firebase ID-token auth for app requests.

The app sends `Authorization: Bearer <Firebase ID token>`. We verify it locally with
Google's published signing certificates (cached per their Cache-Control), checking
signature, expiry, audience (our Firebase project) and issuer — no per-request call
to Google.

Reporters are stored only as `reporter_hash` = HMAC(salt, uid): corroboration and
per-device caps can count distinct reporters without the database holding user ids.
"""
import hashlib
import hmac
import logging
import threading
import time
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Header, HTTPException
from google.auth import jwt as google_jwt

from moby.config import get_settings

log = logging.getLogger("moby.api.auth")

CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"


@dataclass(frozen=True)
class Caller:
    uid: str
    reporter_hash: str


class _CertCache:
    def __init__(self) -> None:
        self._certs: dict[str, str] = {}
        self._expires = 0.0
        self._lock = threading.Lock()

    def get(self) -> dict[str, str]:
        with self._lock:
            if time.time() < self._expires and self._certs:
                return self._certs
            resp = httpx.get(CERTS_URL, timeout=10)
            resp.raise_for_status()
            max_age = 3600
            for part in resp.headers.get("cache-control", "").split(","):
                if part.strip().startswith("max-age="):
                    max_age = int(part.strip().split("=", 1)[1])
            self._certs, self._expires = resp.json(), time.time() + max_age
            return self._certs


_certs = _CertCache()


def reporter_hash(uid: str) -> str:
    salt = get_settings().moby_reporter_salt.get_secret_value().encode()
    return hmac.new(salt, uid.encode(), hashlib.sha256).hexdigest()[:32]


def verify_firebase_token(token: str) -> str:
    """Returns the Firebase uid, or raises ValueError."""
    project = get_settings().firebase_project_id
    if not project:
        raise ValueError("FIREBASE_PROJECT_ID is not configured")
    claims = google_jwt.decode(token, certs=_certs.get(), audience=project)
    if claims.get("iss") != f"https://securetoken.google.com/{project}":
        raise ValueError("wrong issuer")
    uid = claims.get("sub") or ""
    if not uid:
        raise ValueError("token has no subject")
    return uid


def require_user(authorization: Annotated[str | None, Header()] = None) -> Caller:
    """FastAPI dependency (sync on purpose: FastAPI runs it in a threadpool, so the
    occasional certificate refresh never blocks the event loop)."""
    s = get_settings()
    if s.moby_auth_disabled:
        uid = "dev-user"
    else:
        token = (authorization or "").removeprefix("Bearer ").strip()
        if not token:
            raise HTTPException(401, "sign in required")
        try:
            uid = verify_firebase_token(token)
        except ValueError as e:
            raise HTTPException(401, f"invalid token: {e}") from e
        except httpx.HTTPError as e:
            log.warning("could not fetch Firebase certificates: %s", e)
            raise HTTPException(503, "cannot verify sign-in right now") from e
    return Caller(uid=uid, reporter_hash=reporter_hash(uid))
