"""App Check (only the official app may call /v1/*): token verification and the middleware modes."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from moby.api import appcheck
from moby.config import get_settings

PROJECT = "123456789012"


class FakeJWKS:
    """Stands in for PyJWKClient: returns our test key for our kid."""

    def __init__(self, key):
        self.key = key

    def get_signing_key_from_jwt(self, token):
        if jwt.get_unverified_header(token).get("kid") != "test-kid":
            raise jwt.PyJWKClientError("unknown kid")
        return type("K", (), {"key": self.key.public_key()})()


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(key, *, project=PROJECT, exp_in=3600, kid="test-kid", sub="1:123:android:abc"):
    now = int(time.time())
    return jwt.encode({"iss": f"https://firebaseappcheck.googleapis.com/{project}",
                       "aud": [f"projects/{project}", "projects/moby"], "sub": sub,
                       "iat": now, "exp": now + exp_in}, key, algorithm="RS256", headers={"kid": kid})


def test_verify(key):
    jwks = FakeJWKS(key)
    assert appcheck.verify(token(key), PROJECT, jwks)["sub"] == "1:123:android:abc"
    with pytest.raises((jwt.InvalidIssuerError, jwt.InvalidAudienceError)):
        appcheck.verify(token(key, project="999"), PROJECT, jwks)          # another Firebase project
    with pytest.raises(jwt.ExpiredSignatureError):
        appcheck.verify(token(key, exp_in=-10), PROJECT, jwks)
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(jwt.InvalidSignatureError):
        appcheck.verify(token(other), PROJECT, jwks)                       # forged with another key


def test_exempt_paths():
    assert appcheck.exempt("/healthz") and appcheck.exempt("/console/") and appcheck.exempt("/internal/v1/backup")
    assert appcheck.exempt("/v1/review/queue")
    assert not appcheck.exempt("/v1/alerts") and not appcheck.exempt("/v1/me/devices")


@pytest.fixture
def client(monkeypatch, key):
    monkeypatch.setenv("FIREBASE_PROJECT_NUMBER", PROJECT)
    monkeypatch.setattr(appcheck, "_client", lambda: FakeJWKS(key))
    get_settings.cache_clear()
    from moby.api.app import app
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    get_settings.cache_clear()


def status(client, monkeypatch, mode, headers=None, path="/v1/config"):
    monkeypatch.setenv("MOBY_APP_CHECK", mode)
    get_settings.cache_clear()
    return client.get(path, headers=headers or {}).status_code


def test_modes(client, monkeypatch, key):
    good = {appcheck.HEADER: token(key)}
    bad = {appcheck.HEADER: token(key, project="999")}
    assert status(client, monkeypatch, "off") == 200
    assert status(client, monkeypatch, "monitor") == 200                    # logged, not blocked
    assert status(client, monkeypatch, "enforce") == 401
    assert status(client, monkeypatch, "enforce", bad) == 401
    assert status(client, monkeypatch, "enforce", good) == 200
    # Exempt routes don't need a token even when enforcing.
    assert status(client, monkeypatch, "enforce", path="/healthz") in (200, 503)


def test_enforce_message(client, monkeypatch):
    monkeypatch.setenv("MOBY_APP_CHECK", "enforce")
    get_settings.cache_clear()
    r = client.get("/v1/config")
    assert r.status_code == 401 and "official Moby app" in r.json()["detail"]
