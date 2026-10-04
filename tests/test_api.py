"""API mapping and internal-auth rules (no database needed)."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from moby.api.alerts import to_alert
from moby.api.app import embedding_text, require_service_token

T = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def row(**kw):
    base = dict(
        event_id=uuid.uuid4(), source_feed="noaa", hazard_type="flood", product="Flash Flood Warning",
        marine=False, severity="critical", tier=2, title="Flash Flood Warning issued October 3 by NWS",
        description="Move to higher ground.", first_reported_at=T, expires_at=None, lat=38.5, lon=-122.9,
        distance_km=12.345, raw_payload={"properties": {"areaDesc": "Russian River Basin; Sonoma Coast"}},
    )
    return {**base, **kw}


def test_noaa_alert_has_short_sentence_case_headline_and_place():
    a = to_alert(row())
    assert a["headline"] == "Flash flood warning"
    assert a["location_name"] == "Russian River Basin"
    assert a["source_attribution"] == "National Weather Service"
    assert a["verification_label"] == "official_confirmed"
    assert a["distance_km"] == 12.3 and a["marine"] is False


def test_usgs_headline_uses_magnitude_and_place():
    a = to_alert(row(source_feed="usgs", hazard_type="earthquake", product="earthquake", severity="low",
                     raw_payload={"properties": {"mag": 3.42, "place": "6 km NW of The Geysers, CA"}}))
    assert a["headline"] == "Magnitude 3.4 earthquake"
    assert a["location_name"] == "6 km NW of The Geysers, CA"


def test_tier_drives_verification_label():
    assert to_alert(row(tier=1, source_feed="eonet"))["verification_label"] == "corroborated_report"
    assert to_alert(row(tier=0))["verification_label"] == "unverified_report"


def test_empty_fields_are_omitted_not_null():
    a = to_alert(row(description=None, expires_at=None, raw_payload={}))
    assert "body" not in a and "expires_at" not in a and "location_name" not in a


def test_embedding_text_combines_kind_headline_and_details():
    assert embedding_text({"product": "Flood Warning", "hazard_type": "flood", "title": "Flood Warning for X",
                           "description": "River above flood stage."}) == \
        "Flood Warning. Flood Warning for X. River above flood stage."


def test_internal_routes_require_the_service_token(monkeypatch):
    monkeypatch.delenv("MOBY_SERVICE_TOKEN", raising=False)
    with pytest.raises(HTTPException) as e:
        require_service_token("Bearer anything")
    assert e.value.status_code == 403            # disabled when no token is configured
    monkeypatch.setenv("MOBY_SERVICE_TOKEN", "s3cret")
    with pytest.raises(HTTPException) as e:
        require_service_token("Bearer wrong")
    assert e.value.status_code == 401
    with pytest.raises(HTTPException):
        require_service_token(None)
    assert require_service_token("Bearer s3cret") is None
