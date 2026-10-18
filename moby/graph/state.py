from typing import Any, Literal, TypedDict


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


class EvidenceItem(TypedDict, total=False):
    """One numbered thing a brief may cite (built by gather_evidence; web items in Step 4)."""
    id: str                                            # "O1", "C2", "W1": what claims cite
    kind: Literal["official", "community", "news"]
    title: str                                         # shown in the app's source list
    text: str                                          # what the model reads
    url: str | None                                    # web sources only


class BriefState(TypedDict, total=False):
    """State of the brief graph for one event (docs/situation-brief-plan.md)."""
    event_id: str
    facts: dict[str, Any]                              # brief_queries.event_facts: also the snapshot "what changed" diffs
    community: list[dict[str, Any]]                    # brief_queries.community_evidence: one group per effect
    previous: dict[str, Any] | None                    # brief_queries.previous_version: None on a first brief
    evidence: list[EvidenceItem]                       # O1…, C1…, then W1… (Step 4): the only things a brief may cite
    web: list[dict[str, Any]]                          # Step 4: Tavily results before they become W items
    draft: dict[str, Any]                              # Step 3: Ultra's BriefDraft, as a dict (checkpointable)
    problems: list[str]                                # Step 5: what check_brief found wrong with the draft
    attempts: int                                      # Step 5: write_brief tries so far
    changes: list[dict[str, Any]]                      # Step 6: computed differences from previous facts
    changes_text: str | None                           # Step 6: Super's sentence about `changes`
