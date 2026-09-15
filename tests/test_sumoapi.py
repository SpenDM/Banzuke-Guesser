import pytest

from scraper import sumoapi
from scraper.model import Basho, Tournament, next_tournament


def test_parse_rank():
    assert sumoapi.parse_rank("Sekiwake 2 East") == ("S", 2, "E")
    assert sumoapi.parse_rank("Maegashira 16 West") == ("M", 16, "W")
    assert sumoapi.parse_rank("Juryo 1 East") == ("J", 1, "E")
    with pytest.raises(ValueError):
        sumoapi.parse_rank("Makushita 1 East")


def test_rows_from_payload(fixture_json):
    rows = sumoapi.rows_from_payload(fixture_json("sumoapi_202607_makuuchi.json"))
    assert len(rows) == 42
    by_name = {r.name: r for r in rows}
    waka = by_name["Wakatakakage"]
    assert (waka.rank, waka.num, waka.side) == ("S", 2, "E")
    assert waka.record == "0-0-15"
    assert by_name["Onosato"].record == "9-6"
    assert by_name["Hoshoryu"].record == "7-7-1"
    assert by_name["Hoshoryu"].profile_url is None


def test_full_basho_validates_cleanly(fixture_json):
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
