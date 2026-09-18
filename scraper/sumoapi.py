"""Fallback / bootstrap source: https://sumo-api.com (full historical archive)."""
from __future__ import annotations

import re
import sys

import requests

from .http import session
from .model import Basho, NotAvailable, RikishiRow, Tournament, make_key

BASHO_URL = "https://sumo-api.com/api/basho/{basho_id}"
BANZUKE_URL = "https://sumo-api.com/api/basho/{basho_id}/banzuke/{division}"
RIKISHIS_URL = "https://sumo-api.com/api/rikishis?limit=1000"   # active rikishi only, ~600
RIKISHI_URL = "https://sumo-api.com/api/rikishi/{api_id}"
RANK_CODE = {"Yokozuna": "Y", "Ozeki": "O", "Sekiwake": "S", "Komusubi": "K",
             "Maegashira": "M", "Juryo": "J"}
_RANK_RE = re.compile(r"^(Yokozuna|Ozeki|Sekiwake|Komusubi|Maegashira|Juryo) (\d+) (East|West)$")


def parse_rank(text: str) -> tuple[str, int, str]:
    m = _RANK_RE.match(text.strip())
    if not m:
        raise ValueError(f"unrecognised rank string: {text!r}")
    return RANK_CODE[m.group(1)], int(m.group(2)), m.group(3)[0]


def _get(url: str) -> dict:
    resp = session().get(url, timeout=30)
    if resp.status_code == 404:
        raise NotAvailable(f"sumo-api.com has nothing at {url}")
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict) and data.get("error"):
        raise NotAvailable(f"sumo-api.com error for {url}: {data['error']}")
    return data


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


# sumo-api.com's own rikishi id -> sumo.or.jp id (`nskId`), the stable id stored on every row.
_nsk_ids: dict[int, int] | None = None


def nsk_ids() -> dict[int, int]:
    """The api id -> nskId map for every active rikishi, fetched once; {} when the list is unavailable."""
    global _nsk_ids
    if _nsk_ids is None:
        try:
            records = _get(RIKISHIS_URL).get("records") or []
        except (NotAvailable, requests.RequestException, ValueError) as e:
            log(f"warning: could not fetch the sumo-api.com rikishi list ({e}); ids will be looked up one by one")
            records = []
        _nsk_ids = {int(r["id"]): int(r["nskId"]) for r in records if r.get("nskId")}
    return _nsk_ids


def nsk_id_for(api_id: int) -> int | None:
    """nskId of one rikishi: from the cached list, else (retired since) their own record."""
    ids = nsk_ids()
    if api_id not in ids:
        try:
            nsk = _get(RIKISHI_URL.format(api_id=api_id)).get("nskId")
        except (NotAvailable, requests.RequestException, ValueError) as e:
            log(f"warning: no sumo.or.jp id for sumo-api rikishi {api_id} ({e})")
            return None
        if not nsk:
            return None
        ids[api_id] = int(nsk)
    return ids[api_id]


def rows_from_payload(payload: dict, with_ids: bool = True) -> list[RikishiRow]:
    """Rows of one division's banzuke payload; `with_ids=False` skips the rikishi-id lookups."""
    rows = []
    for side in ("east", "west"):
        for r in payload.get(side) or []:
            code, num, ew = parse_rank(r["rank"])
            name = r["shikonaEn"].strip()
            api_id = r.get("rikishiID")
            rows.append(RikishiRow(
                key=make_key(name),
                name=name,
                rank=code,
                num=num,
                side=ew,
                wins=int(r.get("wins") or 0),
                losses=int(r.get("losses") or 0),
                absences=int(r.get("absences") or 0),
                retired=False,
                note=None,
                profile_url=None,
                rikishi_id=nsk_id_for(int(api_id)) if with_ids and api_id else None,
            ))
    return rows


def build_basho(tournament: Tournament, require_results: bool = True) -> Basho:
    """`require_results=False` accepts the freshly announced banzuke, whose results are all zero."""
    rows: list[RikishiRow] = []
    for division in ("Makuuchi", "Juryo"):
        rows += rows_from_payload(_get(BANZUKE_URL.format(basho_id=tournament.id, division=division)))
    if not rows:
        raise NotAvailable(f"sumo-api.com returned no rikishi for {tournament.id}")
    if require_results and all(r.wins + r.losses + r.absences == 0 for r in rows):
        raise NotAvailable(f"sumo-api.com has no results yet for {tournament.id}")
    return Basho(
        id=tournament.id,
        name=tournament.name,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        source="sumo-api.com",
        rikishi=rows,
    )
