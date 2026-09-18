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
    suspended: bool = False   # announced, set via overrides; ranked as a full absence
    note: str | None = None
    profile_url: str | None = None
    # sumo.or.jp rikishi id (sumo-api.com's `nskId`). Unlike `key` it survives a shikona change,
    # so annotate.py uses it to find the same rikishi in earlier basho. None when unknown.
    rikishi_id: int | None = None
    # Indicators computed by annotate.py from the previous basho (all off by default).
    yusho: bool = False              # division champion
    jun_yusho: bool = False          # tied for the best Makuuchi record among non-champions this basho
    kadoban: bool = False            # Ozeki who had a make-koshi last basho
    tsunatori: bool = False          # Ozeki with a yusho / jun-yusho last basho (Yokozuna run)
    # tsunatori earned via a jun-yusho last basho (not an outright win): completing the run this
    # basho needs an actual yusho, since two jun-yusho in a row don't count.
    tsunatori_needs_yusho: bool = False
    ozeki_run: int | None = None     # Sekiwake: wins over the previous two sanyaku basho, when >= 18
    ozeki_return: bool = False       # Sekiwake who was Ozeki last basho (10 wins regain the rank)

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

    @classmethod
    def from_dict(cls, d: dict) -> "Basho":
        """Inverse of to_dict(): rebuild a Basho from a data/basho/*.json payload."""
        fields = {f for f in RikishiRow.__dataclass_fields__}
        rows = [RikishiRow(**{k: v for k, v in r.items() if k in fields}) for r in d["rikishi"]]
        return cls(id=d["id"], name=d["name"], start_date=d["start_date"], end_date=d["end_date"],
                   source=d["source"], rikishi=rows, next=d.get("next"),
                   fetched_at=d.get("fetched_at") or cls.__dataclass_fields__["fetched_at"].default_factory())

    def to_banzuke_dict(self, banzuke_date: str) -> dict:
        """The announced banzuke (Makuuchi slots only, no results): what predictions are scored against."""
        rows = [{"key": r.key, "name": r.name, "rank": r.rank, "num": r.num, "side": r.side,
                 "rikishi_id": r.rikishi_id}
                for r in self.sorted_rikishi() if r.division == "makuuchi"]
        return {
            "id": self.id,
            "name": self.name,
            "banzuke_date": banzuke_date,
            "start_date": self.start_date,
            "end_date": self.end_date,
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


def previous_id(basho_id: str) -> str:
    """The basho before `basho_id` (tournaments are held in odd months)."""
    year, month = int(basho_id[:4]), int(basho_id[4:6])
    return f"{year - 1:04d}11" if month == 1 else f"{year:04d}{month - 2:02d}"


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


def banzuke_path(data_dir: Path, basho_id: str) -> Path:
    return data_dir / "banzuke" / f"{basho_id}.json"


def banzuke_exists(data_dir: Path, basho_id: str) -> bool:
    return banzuke_path(data_dir, basho_id).exists()


def write_banzuke(data_dir: Path, basho: Basho, banzuke_date: str) -> Path:
    path = banzuke_path(data_dir, basho.id)
    write_json(path, basho.to_banzuke_dict(banzuke_date))
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


def basho_path(data_dir: Path, basho_id: str) -> Path:
    return data_dir / "basho" / f"{basho_id}.json"


def basho_exists(data_dir: Path, basho_id: str) -> bool:
    return basho_path(data_dir, basho_id).exists()


def read_basho(data_dir: Path, basho_id: str) -> Basho:
    return Basho.from_dict(json.loads(basho_path(data_dir, basho_id).read_text(encoding="utf-8")))
