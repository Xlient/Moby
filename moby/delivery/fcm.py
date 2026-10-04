"""Firebase Cloud Messaging (HTTP v1) sender.

Credentials: a Firebase Admin service-account JSON, passed whole in the
FIREBASE_SERVICE_ACCOUNT_JSON environment variable (a MysteryBox secret on Nebius).
"""
import json
import logging
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx
from google.auth.transport.requests import Request
from google.oauth2 import service_account

log = logging.getLogger("moby.delivery.fcm")

SCOPE = "https://www.googleapis.com/auth/firebase.messaging"

Outcome = Literal["sent", "failed", "invalid_token"]


@dataclass(frozen=True)
class Push:
    token: str
    title: str
    body: str
    data: dict[str, str]
    critical: bool
    # Same tag = the phone replaces the earlier notification for this event instead of stacking.
    tag: str


@dataclass(frozen=True)
class Result:
    outcome: Outcome
    error: str | None = None


class Sender(Protocol):
    def send(self, push: Push) -> Result: ...


def message(push: Push) -> dict:
    return {
        "message": {
            "token": push.token,
            "notification": {"title": push.title, "body": push.body},
            "data": push.data,
            "android": {
                "priority": "high",
                "notification": {
                    # Channels are created by the app (src/lib/notifications.ts).
                    "channel_id": "critical" if push.critical else "alerts",
                    "tag": push.tag,
                },
            },
            "apns": {"payload": {"aps": {"interruption-level": "time-sensitive" if push.critical else "active"}}},
        }
    }


class FcmSender:
    def __init__(self, service_account_json: str, timeout: float = 10.0):
        info = json.loads(service_account_json)
        self._creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
        self._url = f"https://fcm.googleapis.com/v1/projects/{info['project_id']}/messages:send"
        self._http = httpx.Client(timeout=timeout)

    def _token(self) -> str:
        if not self._creds.valid:
            self._creds.refresh(Request())
        return self._creds.token

    def send(self, push: Push) -> Result:
        try:
            resp = self._http.post(self._url, json=message(push),
                                   headers={"Authorization": f"Bearer {self._token()}"})
        except Exception as e:  # network, auth refresh
            return Result("failed", f"{type(e).__name__}: {e}"[:300])
        if resp.status_code == 200:
            return Result("sent")
        detail = resp.text[:300]
        # UNREGISTERED (404) = app uninstalled / token rotated; INVALID_ARGUMENT on the token = malformed.
        if resp.status_code == 404 or (resp.status_code == 400 and "registration token" in detail.lower()):
            return Result("invalid_token", detail)
        return Result("failed", f"HTTP {resp.status_code}: {detail}")
