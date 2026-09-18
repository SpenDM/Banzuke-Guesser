import pytest

from scraper import sumoapi
from scraper.model import Basho, Tournament, next_tournament


def test_parse_rank():
    assert sumoapi.parse_rank("Sekiwake 2 East") == ("S", 2, "E")
    assert sumoapi.parse_rank("Maegashira 16 West") == ("M", 16, "W")
    assert sumoapi.parse_rank("Juryo 1 East") == ("J", 1, "E")
    with pytest.raises(ValueError):
        sumoapi.parse_rank("Makushita 1 East")


@pytest.fixture
def nsk_ids(monkeypatch):
    """Stand in for the sumo-api.com rikishi list: api id 19 (Hoshoryu) -> nskId 3842, others unknown."""
    monkeypatch.setattr(sumoapi, "_nsk_ids", {19: 3842})
    # Anyone not on the list would be looked up individually; pretend that finds nothing.
    monkeypatch.setattr(sumoapi, "_get", lambda url: {})
    return sumoapi._nsk_ids


def test_rows_from_payload(fixture_json, nsk_ids):
    rows = sumoapi.rows_from_payload(fixture_json("sumoapi_202607_makuuchi.json"))
    assert len(rows) == 42
    by_name = {r.name: r for r in rows}
    waka = by_name["Wakatakakage"]
    assert (waka.rank, waka.num, waka.side) == ("S", 2, "E")
    assert waka.record == "0-0-15"
    assert by_name["Onosato"].record == "9-6"
    assert by_name["Hoshoryu"].record == "7-7-1"
    assert by_name["Hoshoryu"].profile_url is None
    # The stable id comes from the api id -> nskId map; unknown ones are left unset, not guessed.
    assert by_name["Hoshoryu"].rikishi_id == 3842
    assert by_name["Onosato"].rikishi_id is None


def test_rows_from_payload_can_skip_id_lookups(fixture_json, monkeypatch):
    def boom(url):
        raise AssertionError(f"unexpected request to {url}")
    monkeypatch.setattr(sumoapi, "_nsk_ids", None)
    monkeypatch.setattr(sumoapi, "_get", boom)
    rows = sumoapi.rows_from_payload(fixture_json("sumoapi_202607_makuuchi.json"), with_ids=False)
    assert len(rows) == 42 and all(r.rikishi_id is None for r in rows)


def test_nsk_id_for_falls_back_to_the_rikishi_record(monkeypatch):
    calls = []

    def fake_get(url):
        calls.append(url)
        return {"records": [{"id": 19, "nskId": 3842}, {"id": 2, "nskId": None}]} if "rikishis?" in url \
            else {"id": 7, "nskId": 3600}
    monkeypatch.setattr(sumoapi, "_nsk_ids", None)
    monkeypatch.setattr(sumoapi, "_get", fake_get)
    assert sumoapi.nsk_id_for(19) == 3842
    assert sumoapi.nsk_id_for(7) == 3600     # retired since: not on the active list
    assert sumoapi.nsk_id_for(7) == 3600     # ... and cached after the first lookup
    assert calls == [sumoapi.RIKISHIS_URL, sumoapi.RIKISHI_URL.format(api_id=7)]


def test_build_basho_needs_results_unless_told_otherwise(fixture_json, monkeypatch):
    payload = fixture_json("sumoapi_202607_makuuchi.json")
    for side in ("east", "west"):
        for r in payload[side]:
            r["wins"] = r["losses"] = r["absences"] = 0
    monkeypatch.setattr(sumoapi, "_get", lambda url: payload if "Makuuchi" in url else {"east": [], "west": []})
    monkeypatch.setattr(sumoapi, "nsk_id_for", lambda api_id: None)
    t = Tournament("202609", "September 2026", "Kokugikan", "2026-08-31", "2026-09-13", "2026-09-27")
    with pytest.raises(sumoapi.NotAvailable):
        sumoapi.build_basho(t)
    basho = sumoapi.build_basho(t, require_results=False)
    assert len(basho.rikishi) == 42 and basho.source == "sumo-api.com"


def test_full_basho_validates_cleanly(fixture_json, nsk_ids):
    rows = sumoapi.rows_from_payload(fixture_json("sumoapi_202607_makuuchi.json"))
    rows += sumoapi.rows_from_payload(fixture_json("sumoapi_202607_juryo.json"))
    basho = Basho(id="202607", name="July 2026", start_date="2026-07-12",
                  end_date="2026-07-26", source="sumo-api.com", rikishi=rows)
    assert basho.validation_warnings() == []


def test_next_tournament():
    sched = [
        Tournament("202607", "July 2026", "IG Arena", "2026-06-29", "2026-07-12", "2026-07-26"),
        Tournament("202609", "September 2026", "Kokugikan", "2026-08-31", "2026-09-13", "2026-09-27"),
        Tournament("202611", "November 2026", "Fukuoka", "2026-10-26", "2026-11-08", "2026-11-22"),
    ]
    assert next_tournament(sched, "202607")["id"] == "202609"
    assert next_tournament(sched, "202609")["banzuke_date"] == "2026-10-26"
    assert next_tournament(sched, "202611") is None
