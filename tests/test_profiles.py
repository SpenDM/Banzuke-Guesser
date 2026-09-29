from scraper import profiles
from scraper.profiles import JUN_YUSHO_LABEL, add_jun_yusho


def _row(year, tournament, division, achievements=None):
    return {"year": year, "tournament": tournament, "division": division,
            "rank": "", "record": "", "achievements": achievements or []}


def test_add_jun_yusho_labels_matching_makuuchi_rows_only():
    p = {"rikishi_id": 1, "history": [
        _row(2026, "July", "Makuuchi", ["Kanto-sho (Fighting Spirit Prize)"]),
        _row(2026, "May", "Makuuchi"),
        _row(2025, "July", "Juryo"),
    ]}
    add_jun_yusho([p], {"202607": {1, 2}, "202505": {2}, "202507": {1}})
    assert [r["achievements"] for r in p["history"]] == [
        [JUN_YUSHO_LABEL, "Kanto-sho (Fighting Spirit Prize)"], [], []]
    add_jun_yusho([p], {"202607": {1}})  # idempotent
    assert p["history"][0]["achievements"].count(JUN_YUSHO_LABEL) == 1


def test_jun_yusho_api_ids_are_the_best_non_champions(monkeypatch, fixture_json):
    payloads = {"https://sumo-api.com/api/basho/202607": fixture_json("sumoapi_202607_basho.json"),
                "https://sumo-api.com/api/basho/202607/banzuke/Makuuchi": fixture_json("sumoapi_202607_makuuchi.json")}
    monkeypatch.setattr(profiles.sumoapi, "_get", payloads.__getitem__)
    ids = profiles._jun_yusho_api_ids("202607")
    mak = payloads["https://sumo-api.com/api/basho/202607/banzuke/Makuuchi"]
    rows = [r for s in ("east", "west") for r in mak[s] if r["rikishiID"] != 8854]
    best = max(r["wins"] for r in rows)
    assert ids and 8854 not in ids
    assert ids == sorted(r["rikishiID"] for r in rows if r["wins"] == best)
