"""Normalized data model shared by every source, plus JSON writers."""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

# Rank type codes in banzuke order (top first).
RANK_ORDER = ["Y", "O", "S", "K", "M", "J"]
RANK_NAMES = {
    "Y": "Yokozuna",
    "O": "Ozeki",
    "S": "Sekiwake",
    "K": "Komusubi",
    "M": "Maegashira",
    "J": "Juryo",
}
DIVISION_OF_RANK = {"Y": "makuuchi", "O": "makuuchi", "S": "makuuchi",
                    "K": "makuuchi", "M": "makuuchi", "J": "juryo"}

MONTH_NAMES = {1: "January", 3: "March", 5: "May", 7: "July",
               9: "September", 11: "November"}


class NotAvailable(Exception):
    """The source cannot provide the requested basho (yet / any more)."""


@dataclass
class Tournament:
    id: str            # YYYYMM of the first day
    name: str          # e.g. "July 2026"
    venue: str
    banzuke_date: str  # ISO date the banzuke is announced
    start_date: str    # ISO date of day 1
    end_date: str      # ISO date of day 15

    @staticmethod
    def id_for(d: date) -> str:
        return f"{d.year:04d}{d.month:02d}"

    @staticmethod
    def name_for(basho_id: str) -> str:
        year, month = int(basho_id[:4]), int(basho_id[4:6])
        return f"{MONTH_NAMES.get(month, date(year, month, 1).strftime('%B'))} {year}"


@dataclass
class RikishiRow:
    key: str
    name: str
    rank: str          # one of RANK_ORDER
    num: int           # seat ordinal for Y/O/S/K, maegashira/juryo number otherwise
    side: str          # "E" or "W"
    wins: int
    losses: int
    absences: int
    retired: bool = False
    note: str | None = None
    profile_url: str | None = None

    @property
    def division(self) -> str:
        return DIVISION_OF_RANK[self.rank]

    @property
    def slot(self) -> str:
        return f"{self.rank}{self.num}{self.side}"

    @property
    def record(self) -> str:
        rec = f"{self.wins}-{self.losses}"
        if self.absences:
            rec += f"-{self.absences}"
        return rec

    def sort_key(self) -> tuple:
        return (RANK_ORDER.index(self.rank), self.num, 0 if self.side == "E" else 1)


@dataclass
class Basho:
    id: str
    name: str
    start_date: str
    end_date: str
    source: str
    rikishi: list[RikishiRow]
    next: dict | None = None
    fetched_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def sorted_rikishi(self) -> list[RikishiRow]:
        return sorted(self.rikishi, key=RikishiRow.sort_key)

    def to_dict(self) -> dict:
        rows = []
        for r in self.sorted_rikishi():
            d = asdict(r)
            d["division"] = r.division
            d["record"] = r.record
            rows.append(d)
        return {
            "id": self.id,
            "name": self.name,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "next": self.next,
            "source": self.source,
            "fetched_at": self.fetched_at,
            "rikishi": rows,
        }

    def validation_warnings(self) -> list[str]:
        """Soft checks: a finished basho should have 15 bouts accounted for per rikishi."""
        warnings = []
        for r in self.rikishi:
            total = r.wins + r.losses + r.absences
            if total != 15 and not r.retired:
                warnings.append(f"{r.name} ({r.slot}) has {total} bouts accounted for ({r.record})")
        n_mak = sum(1 for r in self.rikishi if r.division == "makuuchi")
        n_jur = sum(1 for r in self.rikishi if r.division == "juryo")
        if n_mak != 42:
            warnings.append(f"Makuuchi has {n_mak} rikishi (expected 42)")
        if n_jur != 28:
            warnings.append(f"Juryo has {n_jur} rikishi (expected 28)")
        return warnings


def make_key(shikona: str) -> str:
    """Stable, ASCII-only identifier derived from the romanized shikona."""
    s = unicodedata.normalize("NFKD", shikona).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s


def next_tournament(schedule: list[Tournament], basho_id: str) -> dict | None:
    """The tournament that follows `basho_id` in the schedule, as a plain dict."""
    following = sorted((t for t in schedule if t.id > basho_id), key=lambda t: t.id)
    if not following:
        return None
    t = following[0]
    return {"id": t.id, "name": t.name, "banzuke_date": t.banzuke_date, "start_date": t.start_date}


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_basho(data_dir: Path, basho: Basho) -> Path:
    path = data_dir / "basho" / f"{basho.id}.json"
    write_json(path, basho.to_dict())
    return path


def write_schedule(data_dir: Path, schedule: list[Tournament]) -> Path:
    path = data_dir / "schedule.json"
    write_json(path, [asdict(t) for t in sorted(schedule, key=lambda t: t.id)])
    return path


def update_index(data_dir: Path) -> Path:
    """Rebuild index.json from whatever basho files exist on disk."""
    ids = sorted(p.stem for p in (data_dir / "basho").glob("*.json"))
    path = data_dir / "index.json"
    write_json(path, {"latest": ids[-1] if ids else None, "basho": ids})
    return path


def basho_exists(data_dir: Path, basho_id: str) -> bool:
    return (data_dir / "basho" / f"{basho_id}.json").exists()
