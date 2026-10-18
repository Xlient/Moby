from typing import TypedDict, Any


class PipelineState(TypedDict, total=False):
    report: dict[str, Any]
    structured: dict[str, Any]
    event_id: str
    joined_existing: bool
    official_match: bool
    distinct_reporters: int
    severities: list[str]
    tier: int
    severity: str
    reports_disagree: bool
    review_reason: str | None
    alert_headline: str
    alert_body: str
    attached: bool
    saved: bool
