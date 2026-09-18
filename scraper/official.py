"""Primary source: the Nihon Sumo Kyokai site (English pages).

Both endpoints are the JSON backends of the site's own JavaScript. They only ever
return the *current* basho, so this source works between the final day and the
next banzuke announcement; outside that window `NotAvailable` is raised.
"""
from __future__ import annotations

from .http import session
from .model import Basho, NotAvailable, RikishiRow, Tournament, make_key

BASE = "https://www.sumo.or.jp"
BANZUKE_URL = BASE + "/EnHonbashoBanzuke/indexAjax/{kakuzuke}/1/"
HOSHITORI_URL = BASE + "/EnHonbashoMain/hoshitoriAjax/{kakuzuke}/1/"
PROFILE_URL = BASE + "/EnSumoDataRikishi/profile/{rikishi_id}/"

MAKUUCHI, JURYO = 1, 2
RANK_CODE = {100: "Y", 200: "O", 300: "S", 400: "K", 500: "M", 600: "J"}
AJAX_HEADERS = {"X-Requested-With": "XMLHttpRequest"}


def fetch_banzuke(kakuzuke: int) -> dict:
    resp = session().post(BANZUKE_URL.format(kakuzuke=kakuzuke),
                          data={"kakuzuke_id": kakuzuke, "page": 1},
                          headers=AJAX_HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_hoshitori(kakuzuke: int) -> dict:
    resp = session().post(HOSHITORI_URL.format(kakuzuke=kakuzuke),
                          data={"kakuzuke_id": kakuzuke, "ew_flg": 1},
                          headers=AJAX_HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _rank_of(row: dict) -> tuple[str, int]:
    code = RANK_CODE[int(row["rank"])]
    num = int(row["seat_order"]) if code in "YOSK" else int(row["number"])
    return code, num


def _results_by_rikishi(hoshitori: dict) -> dict[int, dict]:
    """rikishi_id -> {wins, losses, absences, retired}."""
    out: dict[int, dict] = {}
    for side in ("E", "W"):
        retired = {int(r["rikishi_id"]): bool(r.get("retaire")) for r in hoshitori["BanzukeTable"][side]}
        for rid, days in hoshitori["TorikumiData"][side].items():
            rid = int(rid)
            out[rid] = {
                "wins": int(days.get("won_number", 0)),
                "losses": int(days.get("lost_number", 0)),
                "absences": int(days.get("rest_number", 0)),
                "retired": retired.get(rid, False),
            }
    return out


def rows_from_payloads(banzuke: dict, hoshitori: dict) -> list[RikishiRow]:
    results = _results_by_rikishi(hoshitori)
    rows = []
    for entry in banzuke["BanzukeTable"]:
        if not entry.get("banzuke_id"):
            continue  # empty slot placeholder
        rid = int(entry["rikishi_id"])
        code, num = _rank_of(entry)
        res = results.get(rid, {"wins": 0, "losses": 0, "absences": 0, "retired": False})
        name = entry["shikona"].split("(")[0].strip()
        rows.append(RikishiRow(
            key=make_key(name),
            name=name,
            rank=code,
            num=num,
            side="E" if int(entry["ew"]) == 1 else "W",
            wins=res["wins"],
            losses=res["losses"],
            absences=res["absences"],
            retired=res["retired"],
            note=(entry.get("rank_new") or None),
            profile_url=PROFILE_URL.format(rikishi_id=rid),
            rikishi_id=rid,
        ))
    return rows


def current_basho_info() -> dict:
    return fetch_banzuke(MAKUUCHI)["BashoInfo"]


def build_basho(tournament: Tournament, require_results: bool = True) -> Basho:
    """Fetch Makuuchi + Juryo for `tournament`; raise NotAvailable if the site shows a different basho.

    The site shows the upcoming basho from its announcement day, so with `require_results=False`
    this also fetches a freshly announced banzuke (results all zero).
    """
    mak_banzuke = fetch_banzuke(MAKUUCHI)
    info = mak_banzuke["BashoInfo"]
    if info.get("end_date") != tournament.end_date:
        raise NotAvailable(
            f"sumo.or.jp currently shows basho ending {info.get('end_date')}, wanted {tournament.end_date}")
    rows = rows_from_payloads(mak_banzuke, fetch_hoshitori(MAKUUCHI))
    rows += rows_from_payloads(fetch_banzuke(JURYO), fetch_hoshitori(JURYO))
    return Basho(
        id=tournament.id,
        name=tournament.name,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        source="sumo.or.jp",
        rikishi=rows,
    )
