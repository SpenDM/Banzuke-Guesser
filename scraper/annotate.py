"""Rank-change indicators derived from the previous one or two basho.

The banzuke committee's decisions at the top of the sheet hinge on facts from *before* the
tournament (kadoban, a Yokozuna/Ozeki run, a just-demoted Ozeki) plus who won it. `annotate`
sets the corresponding RikishiRow fields; `apply` gathers the inputs (local data files, else
sumo-api.com, the only source with history) and tolerates a missing source by leaving flags off.
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

from . import sumoapi
from .model import Basho, NotAvailable, RikishiRow, basho_exists, make_key, previous_id, read_basho

KACHI_KOSHI = 8
OZEKI_TARGET = 33          # wins over three sanyaku basho for Ozeki promotion
OZEKI_RUN_MIN_PRIOR = 18   # fewer than this over the previous two and 33 is out of reach
YUSHO_DIVISIONS = ("Makuuchi", "Juryo")


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def jun_yusho_keys(rows: list[RikishiRow], yusho_keys: set[str]) -> set[str]:
    """Makuuchi runners-up: the best win total among non-champions (ties all count)."""
    others = [r for r in rows if r.division == "makuuchi" and r.key not in yusho_keys]
    if not others:
        return set()
    best = max(r.wins for r in others)
    return {r.key for r in others if r.wins == best}


def annotate(basho: Basho, prev1: list[RikishiRow] | None, prev2: list[RikishiRow] | None,
             yusho_keys: set[str], prev1_yusho_keys: set[str]) -> None:
    """Set the indicator fields on `basho.rikishi` in place.

    `prev1` / `prev2` are the rows of the previous and the one-before-previous basho (None when
    unknown); `yusho_keys` the champions of this basho, `prev1_yusho_keys` those of `prev1`.
    """
    p1 = {r.key: r for r in prev1} if prev1 else {}
    p2 = {r.key: r for r in prev2} if prev2 else {}
    p1_jun = jun_yusho_keys(prev1, prev1_yusho_keys) if prev1 else set()
    for r in basho.rikishi:
        r.yusho = r.key in yusho_keys
        r.kadoban = r.tsunatori = r.ozeki_return = False
        r.ozeki_run = None
        last = p1.get(r.key)
        if r.rank == "O" and last and last.rank == "O":
            r.kadoban = last.wins < KACHI_KOSHI
            r.tsunatori = r.key in prev1_yusho_keys or r.key in p1_jun
        if r.rank == "S":
            before = p2.get(r.key)
            r.ozeki_return = bool(last and last.rank == "O")
            if last and before and last.rank in "SK" and before.rank in "SK":
                wins = last.wins + before.wins
                if wins >= OZEKI_RUN_MIN_PRIOR:
                    r.ozeki_run = wins


def _rows_for(basho_id: str, data_dir: Path) -> list[RikishiRow]:
    if basho_exists(data_dir, basho_id):
        return read_basho(data_dir, basho_id).rikishi
    return sumoapi.rows_from_payload(
        sumoapi._get(sumoapi.BANZUKE_URL.format(basho_id=basho_id, division="Makuuchi")))


def _yusho_for(basho_id: str) -> set[str]:
    info = sumoapi._get(sumoapi.BASHO_URL.format(basho_id=basho_id))
    return {make_key(y["shikonaEn"]) for y in info.get("yusho") or [] if y.get("type") in YUSHO_DIVISIONS}


def apply(basho: Basho, data_dir: Path) -> None:
    """Annotate `basho` from local files / sumo-api.com; a source that fails just logs a warning."""
    prev1_id = previous_id(basho.id)
    prev2_id = previous_id(prev1_id)

    def fetch(what, fn, *args):
        try:
            return fn(*args)
        except (NotAvailable, requests.RequestException, KeyError, ValueError) as e:
            log(f"warning: no {what} for indicators ({e})")
            return None

    prev1 = fetch(f"{prev1_id} banzuke", _rows_for, prev1_id, data_dir)
    prev2 = fetch(f"{prev2_id} banzuke", _rows_for, prev2_id, data_dir)
    yusho = fetch(f"{basho.id} yusho", _yusho_for, basho.id) or set()
    prev1_yusho = fetch(f"{prev1_id} yusho", _yusho_for, prev1_id) or set()
    if not yusho:
        log(f"warning: {basho.id} has no yusho recorded; run `annotate --basho {basho.id}` later")
    annotate(basho, prev1, prev2, yusho, prev1_yusho)
