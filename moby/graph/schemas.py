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
