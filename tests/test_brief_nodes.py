"""The brief graph's nodes (docs/situation-brief-plan.md)."""
from moby.graph.brief_nodes import gather_evidence

from .test_brief_queries import make_event
from .test_graph_queries import conn, db_url, fuse_one, seeded  # noqa: F401 (fixtures)


def test_community_event_has_only_community_evidence(conn):  # noqa: F811
    reports = seeded(conn, "corroborated_flood")
    eid = fuse_one(conn, reports[0])
    for r in reports[1:]:
        fuse_one(conn, r)
    out = gather_evidence({"event_id": eid})
    ids = [e["id"] for e in out["evidence"]]
    assert ids and all(i.startswith("C") for i in ids) and ids[0] == "C1"   # no O1: nobody official said anything
    assert all(e["kind"] == "community" and e["text"] for e in out["evidence"])
    assert out["facts"]["reporters"] == 3 and out["previous"] is None


def test_official_event_starts_with_o1(conn):  # noqa: F811
    eid = make_event(conn)
    conn.execute("UPDATE events SET source = 'official', source_feed = 'noaa', external_id = 'x', "
                 "title = 'Flood Warning', description = 'River rising fast.' WHERE event_id = %s", (eid,))
    out = gather_evidence({"event_id": eid})
    first = out["evidence"][0]
    assert first["id"] == "O1" and first["kind"] == "official"
    assert first["title"] == "Flood Warning · National Weather Service" and "River rising fast." in first["text"]
    assert [e["id"] for e in out["evidence"][1:]] == ["C1"]


def test_a_deleted_event_has_no_evidence(conn):  # noqa: F811
    assert gather_evidence({"event_id": "00000000-0000-0000-0000-000000000000"}) == {"evidence": []}
