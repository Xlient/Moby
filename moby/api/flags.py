""""This looks wrong" (contract 0.12.0; table content_flags, migration 0026).

  POST /v1/flags   report an AI answer, explanation, brief, trip briefing or community report

Google Play asks for a way to report AI output and user content from inside the app.
A flag hides nothing by itself (no review gate): partners see open flags in the console
(GET /v1/review/flags). A flag on a community report also queues its event for review
(reason 'user_flag'), where Reject takes it down as for any other queued event.
"""
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from .auth import Caller, require_user

router = APIRouter(prefix="/v1/flags", tags=["flags"])

# Enough for someone working through a bad answer or two; stops a script flooding the console.
MAX_FLAGS_PER_HOUR = 20
EXCERPT_CHARS = 2000

FlagKind = Literal["ask_answer", "explanation", "brief", "trip_brief", "community_report"]
FlagReason = Literal["wrong", "harmful", "spam", "other"]
# Stored where the content lives; the rest aren't stored, so the flag carries the text.
EVENT_KINDS = {"explanation", "brief"}
EXCERPT_KINDS = {"ask_answer", "trip_brief"}


class FlagIn(BaseModel):
    kind: FlagKind
    target_id: str | None = Field(default=None, max_length=64)
    excerpt: str | None = None
    reason: FlagReason
    note: str | None = Field(default=None, max_length=500)

    @field_validator("excerpt", "note")
    @classmethod
    def strip(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None

    @field_validator("excerpt")
    @classmethod
    def cap_excerpt(cls, v: str | None) -> str | None:
        # Capped, not refused: a long answer is still worth flagging.
        return v[:EXCERPT_CHARS] if v else v

    @model_validator(mode="after")
    def has_target(self):
        if self.kind in EXCERPT_KINDS and not self.excerpt:
            raise ValueError(f"{self.kind} needs the excerpt it is about")
        if self.kind not in EXCERPT_KINDS:
            try:
                uuid.UUID(self.target_id or "")
            except ValueError:
                raise ValueError(f"{self.kind} needs target_id (a uuid)") from None
        return self


# Reopen the event for review unless a reviewer already took it down.
QUEUE_SQL = """
INSERT INTO review_queue (event_id, reason) VALUES (%s, 'user_flag')
ON CONFLICT (event_id) DO UPDATE
    SET status = 'open', reason = 'user_flag', queued_at = now(), decision = NULL, decision_note = NULL,
        override_severity = NULL, decided_by = NULL, decided_at = NULL
    WHERE review_queue.status = 'decided' AND review_queue.decision <> 'reject'
"""


def _pool():
    from .app import _pool as app_pool  # late import: app.py owns the pool and imports this module
    return app_pool()


@router.post("", status_code=201)
async def flag_content(flag: FlagIn, caller: Annotated[Caller, Depends(require_user)]):
    async with _pool().connection() as conn, conn.transaction():
        (recent,) = await (await conn.execute(
            "SELECT count(*) FROM content_flags WHERE reporter_hash = %s AND created_at > now() - interval '1 hour'",
            (caller.reporter_hash,))).fetchone()
        if recent >= MAX_FLAGS_PER_HOUR:
            return JSONResponse({"detail": "too many flags; try again later"}, status_code=429,
                                headers={"Retry-After": "600"})
        event_id = None
        if flag.kind == "community_report":
            row = await (await conn.execute(
                "SELECT event_id FROM reports WHERE report_id = %s", (flag.target_id,))).fetchone()
            if row is None:
                raise HTTPException(404, "report not found")
            event_id = row[0]
        elif flag.kind in EVENT_KINDS:
            if await (await conn.execute("SELECT 1 FROM events WHERE event_id = %s", (flag.target_id,))).fetchone() is None:
                raise HTTPException(404, "event not found")
            event_id = flag.target_id
        (flag_id,) = await (await conn.execute(
            """INSERT INTO content_flags (reporter_hash, kind, target_id, event_id, excerpt, reason, note)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING flag_id""",
            (caller.reporter_hash, flag.kind, flag.target_id, event_id, flag.excerpt, flag.reason, flag.note),
        )).fetchone()
        if flag.kind == "community_report" and event_id is not None:
            await conn.execute(QUEUE_SQL, (event_id,))
    return {"flag_id": str(flag_id), "status": "received"}
