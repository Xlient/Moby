from moby.llm import chat_model
from moby.graph.schemas import ReportDetails

SYS_PROMPT = """You read a person's hazard report and fill in the details its note gives. The form already gives the hazard type, what was seen, the severity, the place and the time: never repeat or change those, they're only context.
Only fill a field when the note supports it; otherwise leave it null. Never guess or make up numbers.
Never extract personal information: no names, contact details or addresses. Only details about the hazard itself.
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
    llm = chat_model("nano", temperature=0, timeout=10, max_retries=1).with_structured_output(ReportDetails)
    return llm.invoke([("system", SYS_PROMPT), ("user", message)])
