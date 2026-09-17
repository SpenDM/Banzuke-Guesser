import pytest

from scraper import official
from scraper.model import Basho


@pytest.fixture
def makuuchi_rows(fixture_json):
    return official.rows_from_payloads(
        fixture_json("official_banzuke_makuuchi.json"),
        fixture_json("official_hoshitori_makuuchi.json"))


def test_rows_skip_empty_slots_and_map_ranks(makuuchi_rows):
    assert len(makuuchi_rows) == 42
    by_name = {r.name: r for r in makuuchi_rows}
    onosato = by_name["Onosato"]
    assert (onosato.rank, onosato.num, onosato.side) == ("Y", 1, "E")
    assert onosato.key == "onosato"
    assert onosato.profile_url == "https://www.sumo.or.jp/EnSumoDataRikishi/profile/4227/"
    aonishiki = by_name["Aonishiki"]
    assert (aonishiki.rank, aonishiki.num, aonishiki.side) == ("O", 2, "E")
    assert aonishiki.note == "再大関"
    toshinofuji = by_name["Toshinofuji"]
    assert (toshinofuji.rank, toshinofuji.num, toshinofuji.side) == ("M", 16, "W")
    assert toshinofuji.note == "新入幕"


def test_rows_join_results_by_rikishi_id(makuuchi_rows, fixture_json):
    hoshi = fixture_json("official_hoshitori_makuuchi.json")
    expected = {}
    for side in ("E", "W"):
        for rid, days in hoshi["TorikumiData"][side].items():
            expected[int(rid)] = (days["won_number"], days["lost_number"], days["rest_number"])
    for r in makuuchi_rows:
        rid = int(r.profile_url.rstrip("/").rsplit("/", 1)[1])
        assert r.rikishi_id == rid
        assert (r.wins, r.losses, r.absences) == expected[rid]
    # Somebody was absent in this snapshot, so the record string gets a third component.
    absent = [r for r in makuuchi_rows if r.absences]
    assert absent and all(r.record.count("-") == 2 for r in absent)


def test_juryo_rows(fixture_json):
    rows = official.rows_from_payloads(
        fixture_json("official_banzuke_juryo.json"),
        fixture_json("official_hoshitori_juryo.json"))
    assert len(rows) == 28
    assert {r.rank for r in rows} == {"J"}
    assert {r.division for r in rows} == {"juryo"}
    assert sorted(r.num for r in rows) == sorted(list(range(1, 15)) * 2)


def test_basho_to_dict_is_sorted(makuuchi_rows, fixture_json):
    juryo = official.rows_from_payloads(
        fixture_json("official_banzuke_juryo.json"),
        fixture_json("official_hoshitori_juryo.json"))
    basho = Basho(id="202609", name="September 2026", start_date="2026-09-13",
                  end_date="2026-09-27", source="sumo.or.jp", rikishi=juryo + makuuchi_rows)
    d = basho.to_dict()
    slots = [r["rank"] + str(r["num"]) + r["side"] for r in d["rikishi"]]
    assert slots[:6] == ["Y1E", "Y1W", "O1E", "O1W", "O2E", "S1E"]
    assert slots[-2:] == ["J14E", "J14W"]
    assert d["rikishi"][0]["record"] == "3-0"
    assert d["rikishi"][0]["division"] == "makuuchi"
