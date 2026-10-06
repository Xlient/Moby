"""Firebase App Check: only the official, signed Moby app may call the API.

The app attaches `X-Firebase-AppCheck: <token>`. On Android the token comes from Play
Integrity, which attests the genuine app (our package name, signed with our key,
installed from Play). Builds from the public source, forks and scripts can't get one,
so they can't use the service even with the URL and Firebase config pulled from an APK.

Tokens are JWTs signed by Firebase (RS256, keys at JWKS_URL); we check signature,
expiry, issuer and audience (our project number). Verification is local: keys are
cached, no per-request call to Google.

Mode (MOBY_APP_CHECK): off | monitor (log, allow) | enforce (401).

Not covered, on purpose:
  - /healthz, /console (static page), /console/config;
  - /internal/* — Serverless Jobs, authenticated by the service token;
  - /v1/review/* — the web reviewer console; reviewer accounts are checked by the
    `reviewer` Firebase claim, which public builds can't have either.
"""
import logging
import threading
import time

import jwt
from fastapi import Request
from fastapi.responses import JSONResponse

from moby.config import get_settings

log = logging.getLogger("moby.api.appcheck")

JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks"
HEADER = "X-Firebase-AppCheck"
EXEMPT_PREFIXES = ("/healthz", "/console", "/internal/", "/v1/review", "/docs", "/openapi.json")

_jwks: jwt.PyJWKClient | None = None
_lock = threading.Lock()
# Monitor mode: log a summary at most once a minute instead of every request.
_missing = {"count": 0, "since": time.monotonic()}


def _client() -> jwt.PyJWKClient:
    global _jwks
    with _lock:
        if _jwks is None:
            _jwks = jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=6 * 3600)
        return _jwks


def verify(token: str, project_number: str, jwks: jwt.PyJWKClient | None = None) -> dict:
    """Claims of a valid App Check token; raises jwt.PyJWTError otherwise."""
    key = (jwks or _client()).get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        key.key,
        algorithms=["RS256"],
        audience=f"projects/{project_number}",
        issuer=f"https://firebaseappcheck.googleapis.com/{project_number}",
        options={"require": ["exp", "iss", "aud", "sub"]},
    )
    return claims


def exempt(path: str) -> bool:
    return not path.startswith("/v1/") or path.startswith(EXEMPT_PREFIXES)


def _note_missing(path: str, reason: str) -> None:
    _missing["count"] += 1
    if time.monotonic() - _missing["since"] >= 60:
        log.warning("app check (monitor): %d requests without a valid token in the last minute, e.g. %s (%s)",
                    _missing["count"], path, reason)
        _missing.update(count=0, since=time.monotonic())


async def app_check_middleware(request: Request, call_next):
    s = get_settings()
    mode = s.moby_app_check
    if mode == "off" or exempt(request.url.path) or request.method == "OPTIONS":
        return await call_next(request)
    token = request.headers.get(HEADER, "")
    reason = None
    if not token:
        reason = "no token"
    elif not s.firebase_project_number:
        reason = "server has no FIREBASE_PROJECT_NUMBER"
    else:
        try:
            # PyJWKClient fetches keys synchronously, but only on a cache miss.
            verify(token, s.firebase_project_number)
        except jwt.PyJWTError as e:
            reason = f"invalid token: {type(e).__name__}"
    if reason is None:
        return await call_next(request)
    if mode == "enforce":
        return JSONResponse({"detail": "This API is only available to the official Moby app."}, status_code=401)
    _note_missing(request.url.path, reason)
    return await call_next(request)
