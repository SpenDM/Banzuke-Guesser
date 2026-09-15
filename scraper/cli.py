"""Command line entry point.

    python -m scraper.cli update                       # nightly: fetch whatever just finished
    python -m scraper.cli bootstrap --basho 202607     # seed a specific basho (sumo-api.com by default)
    python -m scraper.cli schedule                     # refresh schedule.json only
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import official, sumoapi
from .model import (Basho, NotAvailable, Tournament, basho_exists, next_tournament,
                    update_index, write_basho, write_schedule)
from .schedule import fetch_schedule, latest_finished

JST = ZoneInfo("Asia/Tokyo")
DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data"


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def fetch_with_fallback(tournament: Tournament, source: str) -> Basho:
    """source: 'auto' (official then sumo-api), 'official', or 'sumoapi'."""
    order = {"auto": [official, sumoapi], "official": [official], "sumoapi": [sumoapi]}[source]
    errors = []
    for module in order:
        try:
            basho = module.build_basho(tournament)
            log(f"fetched {tournament.id} from {basho.source}")
            return basho
        except NotAvailable as e:
            log(f"{module.__name__}: {e}")
            errors.append(str(e))
    raise NotAvailable("; ".join(errors))


def save(data_dir: Path, schedule: list[Tournament], basho: Basho) -> None:
    basho.next = next_tournament(schedule, basho.id)
    for w in basho.validation_warnings():
        log(f"warning: {w}")
    path = write_basho(data_dir, basho)
    update_index(data_dir)
    log(f"wrote {path} ({len(basho.rikishi)} rikishi)")


def cmd_schedule(args) -> int:
    schedule = fetch_schedule()
    path = write_schedule(args.data_dir, schedule)
    log(f"wrote {path} ({len(schedule)} tournaments)")
    return 0


def cmd_update(args) -> int:
    schedule = fetch_schedule()
    write_schedule(args.data_dir, schedule)
    today = datetime.now(JST).date()
    target = latest_finished(schedule, today)
    if target is None:
        log("no finished tournament in the schedule; nothing to do")
        return 0
    if basho_exists(args.data_dir, target.id) and not args.force:
        log(f"{target.id} already present; nothing to do")
        return 0
    try:
        basho = fetch_with_fallback(target, args.source)
    except NotAvailable as e:
        log(f"could not fetch {target.id}: {e}")
        return 1
    save(args.data_dir, schedule, basho)
    return 0


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

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
