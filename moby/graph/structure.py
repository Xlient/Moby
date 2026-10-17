from moby.llm import chat_model
from moby.graph.schemas import ReportDetails

SYS_PROMPT = """You read the free-text note from a hazard report and fill in ONLY the fields in the schema you are given.
The hazard type, severity and what was seen come from the report form and are context only; there are no fields for place or time.
Default every field to null. Fill a field only when the note itself clearly says it; a field the note doesn't mention MUST be null.
In particular: trend is null unless the note describes the hazard changing or explicitly staying the same; extent is null unless the note describes the size of the affected area.
Convert units as the field descriptions say. Never guess numbers. Never extract names, contact details or addresses.
"""


def extract_details(report: dict) -> ReportDetails:
    """Extract structured details from a person's hazard report note."""
    # Only what the model needs: the form's answers as context, and the note. No ids or exact location.
    message = (
        f"Hazard type: {report['hazard_type']}\n"
        f"Severity: {report['severity']}\n"
        f"What they saw: {report.get('observed_effect') or 'not given'}\n"
        f"Note: {report['note']}"
    )
    # One retry: a stuck call gives up after about 20 s (2 × 10 s) and the report is fused without details.
    # function_calling: tested on the examples (scripts/eval_structure.py), the default json_schema
    # mode made Nano fill every field (e.g. trend 'steady' when the note said nothing): 69% → 92%.
    llm = chat_model("nano", temperature=0, timeout=10, max_retries=1).with_structured_output(
        ReportDetails, method="function_calling")
    return llm.invoke([("system", SYS_PROMPT), ("user", message)])
