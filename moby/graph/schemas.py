from typing import Literal

from pydantic import BaseModel, Field


class ReportDetails(BaseModel):
    """Details from a person's hazard report note that the report form can't capture.

    The form already gives the hazard type, what was seen, the severity, the place and the
    time: never repeat or change those. Only fill a field when the note supports it;
    otherwise leave it null. Never guess numbers.
    """

    # First on purpose: the model writes fields in order, so it reasons before answering.
    # Free text that may echo the note, so it's dropped before saving (see `to_saved`).
    reasoning: str = Field(
        description="Think step by step about what the note says before filling the other fields."
    )
    trend: Literal["worsening", "steady", "improving"] | None = Field(
        default=None,
        description="How the hazard is changing, e.g. 'rising', 'spreading' or 'getting worse' is worsening. "
        "Null if the note doesn't say.",
    )
    extent: Literal["one spot", "a street or block", "a neighbourhood", "a wider area"] | None = Field(
        default=None,
        description="Roughly how large an area the hazard itself covers. Null if the note gives no sense of size.",
    )
    extent_basis: Literal["stated", "inferred"] | None = Field(
        default=None,
        description="'stated' if the note describes the hazard's size; 'inferred' if you concluded it from "
        "other details (for example people trapped somewhere suggests the hazard reaches there). "
        "Null when extent is null.",
    )
    extent_stated_km: float | None = Field(
        default=None, ge=0,
        description="Only if the note gives a size or length for the hazard itself, in km (1 mile = 1.609 km). "
        "Not a distance to or from a place, and not a depth. Null otherwise.",
    )
    water_depth_m: float | None = Field(
        default=None, ge=0,
        description="Water depth if the note gives one, in metres (1 foot = 0.3048 m). Null otherwise.",
    )
    people_hurt: int | None = Field(
        default=None, ge=0,
        description="Number of people the note says are hurt or injured. Trapped or missing is not hurt. "
        "Null if not mentioned; 0 only if the note says nobody is hurt.",
    )
    people_trapped: int | None = Field(
        default=None, ge=0,
        description="Number of people the note says are trapped or stuck. Null if not mentioned.",
    )
    people_missing: int | None = Field(
        default=None, ge=0,
        description="Number of people the note says are missing. Null if not mentioned.",
    )

    def to_saved(self) -> dict:
        """What goes into reports.structured: everything except the free-text reasoning."""
        return self.model_dump(exclude={"reasoning"})


class BriefClaim(BaseModel):
    """One statement in a situational brief, tied to the evidence it rests on."""

    text: str = Field(description="One short, plain-language sentence. No citation markers in the text.")
    basis: Literal["official", "community", "news"] = Field(
        description="Who says so: 'official' ONLY if it rests on an O item (the agency's warning) or a W item "
        "marked (official) (a government website); 'community' if on C items (people's unverified reports); "
        "'news' if on W items marked (news) (a news outlet's report, not official).",
    )
    evidence: list[str] = Field(
        min_length=1,
        description="The ids of the evidence items this sentence rests on, e.g. ['O1'] or ['C1', 'C2']. "
        "Only ids from the evidence list you were given.",
    )


class BriefDraft(BaseModel):
    """A situational brief written ONLY from the numbered evidence list: what is happening,
    who says so, where reports disagree and what isn't known. Every fact is a claim that
    cites evidence ids. Never add places, numbers, times or hazards the evidence doesn't
    contain. Community reports are unverified: never present them as official.
    """

    # First on purpose (as in ReportDetails): the model reasons before writing the brief.
    # Dropped before saving (see `to_saved`).
    reasoning: str = Field(
        description="Think step by step: what each evidence item says, which items agree or disagree, "
        "and what is missing, before writing the other fields."
    )
    summary: str = Field(
        description="2–3 sentences: what is likely happening, saying who reports it (an agency, or people "
        "nearby, unverified). Only facts that also appear in the claims."
    )
    claims: list[BriefClaim] = Field(
        min_length=1, max_length=8,
        description="The facts of the brief, most important first, each citing its evidence.",
    )
    contradictions: list[str] = Field(
        default_factory=list,
        description="Where evidence items disagree (e.g. different severities, or a report the official "
        "warning doesn't mention), each naming the ids involved. Empty if none.",
    )
    likely_progression: str | None = Field(
        default=None,
        description="Only what the evidence itself says about what comes next (e.g. a warning's end time). "
        "Phrase it as an estimate. Null if the evidence doesn't say; never speculate.",
    )
    official_guidance: str | None = Field(
        default=None,
        description="What the agency tells people to do, from O items or (official) W items only, attributed to "
        "the agency. Never from (news) or C items. Null if none of them gives instructions.",
    )
    uncertainty: str = Field(
        min_length=1,
        description="Required. What this brief does not know and where it may be wrong: e.g. reports are "
        "unverified, few people reported, information may be out of date, no official warning yet.",
    )

    def to_saved(self) -> dict:
        """What goes into briefs: everything except the free-text reasoning."""
        return self.model_dump(exclude={"reasoning"})
