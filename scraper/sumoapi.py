"""Fallback / bootstrap source: https://sumo-api.com (full historical archive)."""
from __future__ import annotations

import re

from .http import session
from .model import Basho, NotAvailable, RikishiRow, Tournament, make_key

BASHO_URL = "https://sumo-api.com/api/basho/{basho_id}"
BANZUKE_URL = "https://sumo-api.com/api/basho/{basho_id}/banzuke/{division}"
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


def rows_from_payload(payload: dict) -> list[RikishiRow]:
    rows = []
    for side in ("east", "west"):
        for r in payload.get(side) or []:
            code, num, ew = parse_rank(r["rank"])
            name = r["shikonaEn"].strip()
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
            ))
    return rows


def build_basho(tournament: Tournament) -> Basho:
    rows: list[RikishiRow] = []
    for division in ("Makuuchi", "Juryo"):
        rows += rows_from_payload(_get(BANZUKE_URL.format(basho_id=tournament.id, division=division)))
    if not rows:
        raise NotAvailable(f"sumo-api.com returned no rikishi for {tournament.id}")
    if all(r.wins + r.losses + r.absences == 0 for r in rows):
        raise NotAvailable(f"sumo-api.com has no results yet for {tournament.id}")
    return Basho(
        id=tournament.id,
        name=tournament.name,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        source="sumo-api.com",
        rikishi=rows,
    )
