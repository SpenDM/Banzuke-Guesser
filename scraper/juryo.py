"""Confirmed Juryo promotions: the JSA announces the next basho's new (and returning) Juryo rikishi
a few days after a tournament ends, well before the banzuke itself.

The announcement is the sumo.or.jp page "新十両力士一覧" (Japanese only), headed with the basho it is
for ("令和八年十一月場所") and listing each rikishi's shikona, its reading, and their former shikona
when they take a new one on promotion. `apply` matches those shikona to the rows of the results file
that predicts that basho and sets `juryo_promotion` on them.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

from . import profiles
from .http import session
from .model import basho_exists, read_basho, write_basho

SHIN_JURYO_URL = "https://www.sumo.or.jp/ResultBanzuke/shin_juryo/"
REIWA_START = 2018  # Reiwa 1 is 2019
KANJI_DIGITS = {c: i for i, c in enumerate("〇一二三四五六七八九")}


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def kanji_number(text: str) -> int:
    """'八' -> 8, '十一' -> 11, '二十' -> 20; plain digits pass through."""
    text = text.strip().translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    if text.isdigit():
        return int(text)
    if "十" in text:
        tens, _, ones = text.partition("十")
        return (KANJI_DIGITS[tens] if tens else 1) * 10 + (KANJI_DIGITS[ones] if ones else 0)
    return KANJI_DIGITS[text]


def _strip_reading(text: str) -> str:
    return re.split(r"[\s　(（]", text.strip())[0]


def parse_announcement(html: str) -> dict | None:
    """{basho_id, announced, rikishi: [{shikona, reading, former}]} from the page, or None when it
    names no basho. `announced` is the ISO date the list went up; `former` the shikona before a
    name change on promotion, else None."""
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find(string=re.compile(r"令和\s*\S+?年\s*\S+?月場所"))
    if not heading:
        return None
    m = re.search(r"令和\s*(\S+?)年\s*(\S+?)月場所", heading)
    basho_id = f"{REIWA_START + kanji_number(m.group(1)):04d}{kanji_number(m.group(2)):02d}"
    announced = None
    date = soup.find(string=re.compile(r"令和\s*\d+年\d+月\d+日発表"))
    if date:
        y, mo, d = map(int, re.search(r"令和\s*(\d+)年(\d+)月(\d+)日", date).groups())
        announced = f"{REIWA_START + y:04d}-{mo:02d}-{d:02d}"
    rikishi = []
    # One table per list (new Juryo, and returning Juryo when there are any), each headed しこ名.
    for table in soup.find_all("table"):
        header = table.find("tr")
        if not header or "しこ名" not in header.get_text():
            continue
        for tr in header.find_next_siblings("tr"):
            cells = tr.find_all("td")
            if len(cells) < 3:
                continue
            name = cells[0].find("span")
            shikona = (name or cells[0]).get_text(strip=True)
            reading = re.search(r"[(（](.+?)[)）]", cells[0].get_text())
            former = cells[2].get_text(strip=True) or None
            if shikona:
                rikishi.append({"shikona": _strip_reading(shikona), "reading": reading and reading.group(1),
                                "former": former and _strip_reading(former)})
    return {"basho_id": basho_id, "announced": announced, "rikishi": rikishi}


def fetch_announcement() -> dict | None:
    resp = session().get(SHIN_JURYO_URL, timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return parse_announcement(resp.text)


def japanese_shikona(data_dir: Path) -> dict[int, set[str]]:
    """{sumo.or.jp id: Japanese shikona}: from the profile pages (the top of Makushita, where the
    promotees come from), plus sumo-api.com's list of every active rikishi."""
    out: dict[int, set[str]] = {}
    for path in (data_dir / "profiles").glob("*.json"):
        p = json.loads(path.read_text(encoding="utf-8"))
        if p.get("shikona_ja"):
            out.setdefault(int(p["rikishi_id"]), set()).add(p["shikona_ja"])
    for rid, name in profiles._shikona_ja_by_nsk().items():
        out.setdefault(rid, set()).add(name)
    return out


def match(announced: list[dict], rows, names: dict[int, set[str]]) -> tuple[set[str], list[str]]:
    """(keys of the rows the announcement names, the announced shikona no row matched). A row
    matches by its rikishi's Japanese shikona, current or (after a name change on promotion) former."""
    keys, missing = set(), []
    for a in announced:
        wanted = {a["shikona"], a["former"]} - {None}
        hits = [r.key for r in rows if r.rikishi_id is not None and names.get(r.rikishi_id, set()) & wanted]
        if hits:
            keys.update(hits)
        else:
            missing.append(a["shikona"])
    return keys, missing


def apply(data_dir: Path, announcement: dict | None = None, names: dict[int, set[str]] | None = None) -> int:
    """Mark the confirmed promotees in the latest results file, when the announcement is for the
    basho it predicts. 0 when done (or nothing to do), 1 when an announced rikishi could not be
    found in the file."""
    announcement = announcement if announcement is not None else fetch_announcement()
    if not announcement:
        log("no Juryo promotion announcement found on sumo.or.jp")
        return 0
    latest = json.loads((data_dir / "index.json").read_text(encoding="utf-8")).get("latest")
    if not latest or not basho_exists(data_dir, latest):
        log("no results file to mark")
        return 0
    basho = read_basho(data_dir, latest)
    target = (basho.next or {}).get("id")
    if target != announcement["basho_id"]:
        log(f"the Juryo promotions posted are for {announcement['basho_id']}; {latest} predicts {target}: nothing to do")
        return 0
    keys, missing = match(announcement["rikishi"], basho.rikishi, names if names is not None else japanese_shikona(data_dir))
    changed = False
    for r in basho.rikishi:
        if r.juryo_promotion != (r.key in keys):
            r.juryo_promotion = r.key in keys
            changed = True
    if changed:
        write_basho(data_dir, basho)
        log(f"marked {len(keys)} confirmed Juryo promotions in {latest}: {', '.join(sorted(keys))}")
    else:
        log(f"{latest} already has the {len(keys)} confirmed Juryo promotions")
    if missing:
        log(f"error: could not find {', '.join(missing)} (announced {announcement['announced']}) in {latest}")
        return 1
    return 0
