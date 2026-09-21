"""Command line entry point.

    python -m scraper.cli update                       # nightly: fetch whatever just finished / was announced
    python -m scraper.cli bootstrap --basho 202607     # seed a specific basho (sumo-api.com by default)
    python -m scraper.cli annotate --basho 202607      # recompute the indicators of an existing file
    python -m scraper.cli banzuke --basho 202609       # fetch an announced banzuke (what guesses are scored on)
    python -m scraper.cli profiles --basho 202607      # (re)build the rikishi profile pages for a basho
    python -m scraper.cli schedule                     # refresh schedule.json only
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import annotate, official, profiles, sumoapi
from .model import (Basho, NotAvailable, Tournament, banzuke_exists, basho_exists, next_tournament,
                    read_basho, update_index, write_banzuke, write_basho, write_schedule)
from .schedule import fetch_schedule, latest_announced, latest_finished

JST = ZoneInfo("Asia/Tokyo")
DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data"


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def fetch_with_fallback(tournament: Tournament, source: str, require_results: bool = True) -> Basho:
    """source: 'auto' (official then sumo-api), 'official', or 'sumoapi'."""
    order = {"auto": [official, sumoapi], "official": [official], "sumoapi": [sumoapi]}[source]
    errors = []
    for module in order:
        try:
            basho = module.build_basho(tournament, require_results=require_results)
            log(f"fetched {tournament.id} from {basho.source}")
            return basho
        except NotAvailable as e:
            log(f"{module.__name__}: {e}")
            errors.append(str(e))
    raise NotAvailable("; ".join(errors))


def save(data_dir: Path, schedule: list[Tournament], basho: Basho) -> None:
    basho.next = next_tournament(schedule, basho.id)
    annotate.apply(basho, data_dir)
    for w in basho.validation_warnings():
        log(f"warning: {w}")
    path = write_basho(data_dir, basho)
    update_index(data_dir)
    log(f"wrote {path} ({len(basho.rikishi)} rikishi)")
    try:
        profiles.write_profiles(data_dir, basho)
    except Exception as e:  # profile pages are a nice-to-have; never fail the basho write over them
        log(f"warning: could not refresh rikishi profiles: {e}")


def cmd_schedule(args) -> int:
    schedule = fetch_schedule()
    path = write_schedule(args.data_dir, schedule)
    log(f"wrote {path} ({len(schedule)} tournaments)")
    return 0


def save_banzuke(data_dir: Path, tournament: Tournament, source: str) -> int:
    """Fetch the announced banzuke of `tournament` into data/banzuke; 1 if no source has it yet."""
    try:
        basho = fetch_with_fallback(tournament, source, require_results=False)
    except NotAvailable as e:
        log(f"could not fetch the {tournament.id} banzuke: {e}")
        return 1
    n = sum(1 for r in basho.rikishi if r.division == "makuuchi")
    if n != 42:
        log(f"warning: the {tournament.id} banzuke has {n} Makuuchi rikishi (expected 42)")
    path = write_banzuke(data_dir, basho, tournament.banzuke_date)
    log(f"wrote {path} ({n} rikishi)")
    return 0


def cmd_update(args) -> int:
    schedule = fetch_schedule()
    write_schedule(args.data_dir, schedule)
    today = datetime.now(JST).date()
    status = 0

    # 1. The results of the tournament that just finished.
    target = latest_finished(schedule, today)
    if target is None:
        log("no finished tournament in the schedule")
    elif basho_exists(args.data_dir, target.id) and not args.force:
        log(f"{target.id} already present")
    else:
        try:
            save(args.data_dir, schedule, fetch_with_fallback(target, args.source))
        except NotAvailable as e:
            log(f"could not fetch {target.id}: {e}")
            status = 1

    # 2. The banzuke that was just announced, which the submitted guesses are scored against.
    announced = latest_announced(schedule, today)
    if announced is None:
        log("no announced banzuke in the schedule")
    elif banzuke_exists(args.data_dir, announced.id) and not args.force:
        log(f"{announced.id} banzuke already present")
    else:
        status = save_banzuke(args.data_dir, announced, args.source) or status
    return status


def cmd_banzuke(args) -> int:
    schedule = fetch_schedule()
    write_schedule(args.data_dir, schedule)
    target = next((t for t in schedule if t.id == args.basho), None)
    if target is None:
        log(f"{args.basho} is not in the published schedule")
        return 1
    return save_banzuke(args.data_dir, target, args.source)


def cmd_bootstrap(args) -> int:
    schedule = fetch_schedule()
    write_schedule(args.data_dir, schedule)
    target = next((t for t in schedule if t.id == args.basho), None)
    if target is None:
        # Older than the published schedule: take dates from sumo-api and derive names.
        info = sumoapi._get(sumoapi.BASHO_URL.format(basho_id=args.basho))
        target = Tournament(
            id=args.basho, name=Tournament.name_for(args.basho), venue="",
            banzuke_date="", start_date=info["startDate"][:10], end_date=info["endDate"][:10])
    try:
        basho = fetch_with_fallback(target, args.source)
    except NotAvailable as e:
        log(f"could not fetch {target.id}: {e}")
        return 1
    save(args.data_dir, schedule, basho)
    return 0


def cmd_annotate(args) -> int:
    if not basho_exists(args.data_dir, args.basho):
        log(f"no data for {args.basho}; run bootstrap first")
        return 1
    basho = read_basho(args.data_dir, args.basho)
    annotate.apply(basho, args.data_dir)
    path = write_basho(args.data_dir, basho)
    log(f"wrote {path}")
    return 0


def cmd_profiles(args) -> int:
    if not basho_exists(args.data_dir, args.basho):
        log(f"no data for {args.basho}; run bootstrap first")
        return 1
    basho = read_basho(args.data_dir, args.basho)
    profiles.write_profiles(args.data_dir, basho)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="scraper")
    p.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("schedule").set_defaults(func=cmd_schedule)

    up = sub.add_parser("update")
    up.add_argument("--source", choices=["auto", "official", "sumoapi"], default="auto")
    up.add_argument("--force", action="store_true", help="re-fetch even if the file exists")
    up.set_defaults(func=cmd_update)

    bs = sub.add_parser("bootstrap")
    bs.add_argument("--basho", required=True, help="YYYYMM")
    bs.add_argument("--source", choices=["auto", "official", "sumoapi"], default="sumoapi")
    bs.set_defaults(func=cmd_bootstrap)

    an = sub.add_parser("annotate")
    an.add_argument("--basho", required=True, help="YYYYMM")
    an.set_defaults(func=cmd_annotate)

    pr = sub.add_parser("profiles")
    pr.add_argument("--basho", required=True, help="YYYYMM")
    pr.set_defaults(func=cmd_profiles)

    bz = sub.add_parser("banzuke")
    bz.add_argument("--basho", required=True, help="YYYYMM")
    bz.add_argument("--source", choices=["auto", "official", "sumoapi"], default="auto")
    bz.set_defaults(func=cmd_banzuke)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
