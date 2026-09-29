"""Rikishi profile pages -> one static JSON per rikishi (public/data/profiles/{id}.json).

The sumo.or.jp English profile page (`/EnSumoDataRikishi/profile/{nskId}/`) is the richest
single source: portrait photo, a fact sheet (real name, stable, birthday, birthplace, size,
signature maneuvers), the highest rank, and a full tournament-records table. Birthplace there
is only a province/country, so it is enriched from sumo-api.com's `shusshin` (which also has
the city). Wrestling style comes from a hand-curated overlay (style_overlay.json), falling
back to a rough guess from the signature maneuvers when a rikishi isn't curated yet.
The records table marks yusho but not jun-yusho, which are worked out from sumo-api.com's
Makuuchi results (cached per basho in public/data/jun_yusho.json, since past basho never change).
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from . import sumoapi
from .http import session
from .model import Basho, NotAvailable, write_json

BASE = "https://www.sumo.or.jp"
PROFILE_URL = BASE + "/EnSumoDataRikishi/profile/{rikishi_id}/"
STYLE_OVERLAY = Path(__file__).resolve().parent / "style_overlay.json"
JUN_YUSHO_LABEL = "Jun-yusho"
MONTH_OF = {"January": 1, "March": 3, "May": 5, "July": 7, "September": 9, "November": 11}

# Division a records-table rank word belongs to (the history table's Division column).
DIVISION_OF = {
    "Yokozuna": "Makuuchi", "Ozeki": "Makuuchi", "Sekiwake": "Makuuchi",
    "Komusubi": "Makuuchi", "Maegashira": "Makuuchi", "Juryo": "Juryo",
    "Makushita": "Makushita", "Sandanme": "Sandanme", "Jonidan": "Jonidan",
    "Jonokuchi": "Jonokuchi", "Banzuke-gai": "Banzuke-gai", "Mae-zumo": "Mae-zumo",
}

# Country -> flag emoji for the birthplace line. Unknown countries just get no flag.
FLAGS = {
    "Japan": "🇯🇵", "Mongolia": "🇲🇳", "Georgia": "🇬🇪", "Russia": "🇷🇺", "Brazil": "🇧🇷",
    "Bulgaria": "🇧🇬", "Ukraine": "🇺🇦", "China": "🇨🇳", "Kazakhstan": "🇰🇿", "Philippines": "🇵🇭",
    "United States": "🇺🇸", "USA": "🇺🇸", "Egypt": "🇪🇬", "Hungary": "🇭🇺", "South Korea": "🇰🇷",
    "Tonga": "🇹🇴", "Samoa": "🇼🇸", "Kyrgyzstan": "🇰🇬",
}


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def _num(text: str | None) -> float | None:
    """The leading number of a value like '190.0cm' or '188.0kg'."""
    if not text:
        return None
    m = re.search(r"[\d.]+", text)
    return float(m.group()) if m else None


def _birth_date(text: str | None) -> str | None:
    """'June 7, 2000' -> '2000-06-07' (age is computed in the browser so files don't stale)."""
    if not text:
        return None
    try:
        return datetime.strptime(text.strip(), "%B %d, %Y").date().isoformat()
    except ValueError:
        return None


def _maneuvers(text: str | None) -> list[str]:
    return [m.strip() for m in (text or "").split(",") if m.strip()]


def _fact_sheet(soup: BeautifulSoup) -> dict[str, str]:
    """The th/td pairs of the profile's info table (Stable, Name, Ring Name, ...)."""
    out: dict[str, str] = {}
    table = soup.find("table", class_="mdTable2")
    if not table:
        return out
    for tr in table.find_all("tr"):
        th, td = tr.find("th"), tr.find("td")
        if th and td:
            out[th.get_text(strip=True)] = td.get_text(" ", strip=True)
    return out


def _highest_rank(soup: BeautifulSoup) -> str | None:
    for dt in soup.find_all("dt"):
        if dt.get_text(strip=True) == "Highest Rank":
            dd = dt.find_next_sibling("dd")
            return dd.get_text(" ", strip=True) if dd else None
    return None


def _photo_url(soup: BeautifulSoup) -> str | None:
    img = (soup.select_one('img[src*="/img/sumo_data/rikishi/270x474/"]')
           or soup.select_one('img[src*="/img/sumo_data/rikishi/"]'))
    if not img or not img.get("src"):
        return None
    src = img["src"]
    return BASE + src if src.startswith("/") else src


def _achievements(raw: str) -> list[str]:
    """Split the achievements span (its entries are nbsp-separated) into tidy labels."""
    out = []
    for part in (p.strip() for p in raw.split("\xa0")):
        if not part:
            continue
        out.append("🏆 Yusho" if "Division Champion" in part else re.sub(r"\s*\(", " (", part))
    return out


def _records(soup: BeautifulSoup) -> list[dict]:
    """The Tournament Records table, newest first: year, tournament, division, rank, record, achievements."""
    table = soup.find("table", class_="main")
    if not table:
        return []
    out = []
    for box in table.select("td.player .box"):
        spans = [s for s in (sp.get_text(" ", strip=True) for sp in box.find_all("span")) if s]
        if len(spans) < 3:
            continue
        ym = spans[0].split()  # "2026\xa0September" -> ["2026", "September"]
        if not ym or not ym[0].isdigit():
            continue
        rec_i = next((i for i, s in enumerate(spans) if re.fullmatch(r"\d+-\d+(?:-\d+)?", s)), None)
        if rec_i is None:
            continue
        # "West Maegashira #5" -> drop the East/West side (the table doesn't need it); the division
        # is named by the first remaining word ("Maegashira" -> Makuuchi, "Juryo" -> Juryo, ...).
        rank = re.sub(r"^(East|West)\s+", "", spans[1])
        rank_word = rank.split()[0] if rank.split() else ""
        out.append({
            "year": int(ym[0]),
            "tournament": ym[1] if len(ym) > 1 else "",
            "division": DIVISION_OF.get(rank_word, rank_word),
            "rank": rank,
            "record": spans[rec_i],
            "achievements": _achievements(spans[rec_i + 1]) if rec_i + 1 < len(spans) else [],
        })
    return out


def _is_japan(place: str) -> bool:
    return place == "Hokkaido" or place.endswith(("-ken", "-to", "-fu"))


def _strip_suffix(place: str | None, suffixes: tuple[str, ...]) -> str | None:
    if not place:
        return None
    for suf in suffixes:
        if place.endswith(suf):
            return place[: -len(suf)]
    return place


def _birthplace(shusshin: str | None, fallback: str | None) -> dict:
    """{flag, country, province, city} from sumo-api's 'Toyama-ken, Toyama-shi' / 'Mongolia, Ulaanbaatar'."""
    if shusshin:
        parts = [p.strip() for p in shusshin.split(",")]
        first = parts[0]
        # The most specific locality (municipality/town), e.g. "Ishikawa-ken, Kahoku-gun,
        # Tsubata-machi" -> "Tsubata"; a lone country/prefecture leaves the city empty.
        city = parts[-1] if len(parts) > 1 else None
        city = _strip_suffix(city, ("-shi", "-ku", "-machi", "-cho", "-mura", "-son", "-gun"))
        if _is_japan(first):
            return {"flag": FLAGS["Japan"], "country": "Japan",
                    "province": _strip_suffix(first, ("-ken", "-to", "-fu")), "city": city}
        return {"flag": FLAGS.get(first), "country": first, "province": None, "city": city}
    # sumo.or.jp fallback: a lone province ("Ishikawa") or country ("Mongolia").
    if fallback:
        if fallback != "Japan" and fallback in FLAGS:
            return {"flag": FLAGS[fallback], "country": fallback, "province": None, "city": None}
        return {"flag": FLAGS["Japan"], "country": "Japan", "province": fallback, "city": None}
    return {"flag": None, "country": None, "province": None, "city": None}


_overlay: dict | None = None


def _style_overlay() -> dict:
    global _overlay
    if _overlay is None:
        try:
            _overlay = json.loads(STYLE_OVERLAY.read_text(encoding="utf-8"))
        except FileNotFoundError:
            _overlay = {}
    return _overlay


def _auto_primary(maneuvers: list[str]) -> str:
    """A rough primary style from the signature maneuvers, for rikishi not yet hand-curated.

    Grappler = yotsu-sumo (belt), Pusher-Thruster = oshi-sumo, All-Rounder = versatile/mixed.
    """
    m = " ".join(maneuvers).lower()
    yotsu = "yotsu" in m or "yori" in m
    oshi = "oshi" in m or "tsuki" in m or "tsuppari" in m
    if oshi and not yotsu:
        return "Pusher-Thruster"
    if yotsu and not oshi:
        return "Grappler"
    return "Grappler" if yotsu else "All-Rounder"


def _style(rikishi_id: int, maneuvers: list[str]) -> dict:
    """{primary, known_for?} from the overlay; weight_class is added later (cohort-relative)."""
    ov = _style_overlay().get(str(rikishi_id)) or {}
    style = {"primary": ov.get("primary") or _auto_primary(maneuvers)}
    if ov.get("known_for"):
        style["known_for"] = ov["known_for"]
    return style


def _weight_classes(weights: list[float | None], cohort: list[bool] | None = None) -> list[str | None]:
    """Heavy / Mid-weight / Light-weight by positional thirds of the cohort (heaviest first).

    `cohort` marks which weights make up the cohort (all of them by default); the others are
    classed by where they fall against the cohort's thirds.
    """
    in_cohort = cohort or [True] * len(weights)
    order = sorted((i for i, w in enumerate(weights) if w is not None and in_cohort[i]),
                   key=lambda i: weights[i], reverse=True)
    n = len(order)
    out: list[str | None] = [None] * len(weights)
    for rank, i in enumerate(order):
        out[i] = "Heavy" if rank < n / 3 else "Mid-weight" if rank < 2 * n / 3 else "Light-weight"
    heavy = [weights[i] for i in order if out[i] == "Heavy"]
    mid = [weights[i] for i in order if out[i] == "Mid-weight"]
    for i, w in enumerate(weights):
        if w is None or in_cohort[i] or not order:
            continue
        out[i] = ("Heavy" if heavy and w >= min(heavy) else
                  "Mid-weight" if mid and w >= min(mid) else "Light-weight")
    return out


def build_profile(rikishi_id: int, shusshin: str | None = None) -> dict:
    """Fetch and parse one rikishi's sumo.or.jp profile into the display JSON."""
    url = PROFILE_URL.format(rikishi_id=rikishi_id)
    resp = session().get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    facts = _fact_sheet(soup)
    if not facts:
        raise ValueError("no profile fact sheet found (page layout changed or rikishi missing)")
    maneuvers = _maneuvers(facts.get("Signature Maneuver"))
    # The Ring Name cell lists shikona history ("Kiribayama → Kirishima"); keep the current one.
    ring = facts.get("Ring Name") or facts.get("Name") or ""
    shikona = ring.split("→")[-1].strip() or None
    return {
        "rikishi_id": rikishi_id,
        "profile_url": url,
        "photo_url": _photo_url(soup),
        "shikona": shikona,
        "real_name": facts.get("Name"),
        "stable": facts.get("Stable"),
        "birthplace": _birthplace(shusshin, facts.get("Birthplace")),
        "current_rank": facts.get("Current Rank"),
        "highest_rank": _highest_rank(soup),
        "birth_date": _birth_date(facts.get("Birthday")),
        "height_cm": _num(facts.get("Height")),
        "weight_kg": _num(facts.get("Weight")),
        "signature_maneuvers": maneuvers,
        "style": _style(rikishi_id, maneuvers),
        "history": _records(soup),
    }


def _shusshin_by_nsk() -> dict[int, str]:
    """{nskId: shusshin} from sumo-api's active-rikishi list, for the birthplace city."""
    try:
        records = sumoapi._get(sumoapi.RIKISHIS_URL).get("records") or []
    except (sumoapi.NotAvailable, requests.RequestException, ValueError) as e:
        log(f"warning: no sumo-api rikishi list for birthplaces ({e})")
        return {}
    return {int(r["nskId"]): r.get("shusshin") for r in records if r.get("nskId")}


def _shikona_ja_by_nsk() -> dict[int, str]:
    """{nskId: shikonaJp} from sumo-api's active-rikishi list."""
    try:
        records = sumoapi._get(sumoapi.RIKISHIS_URL).get("records") or []
    except (sumoapi.NotAvailable, requests.RequestException, ValueError) as e:
        log(f"warning: no sumo-api rikishi list for Japanese shikona ({e})")
        return {}
    out = {}
    for r in records:
        if not r.get("nskId"):
            continue
        jp = (r.get("shikonaJp") or "").strip()
        if jp:
            # Drop the given name after the shikona, and the kana reading lower divisions carry: "西ノ龍(にしのりゅう)".
            out[int(r["nskId"])] = re.split(r"[\s　(（]", jp)[0]
    return out


def _history_basho_id(row: dict) -> str | None:
    """'202609' for a history row of 2026 September."""
    month = MONTH_OF.get(row.get("tournament"))
    return f"{row['year']}{month:02d}" if month else None


def _jun_yusho_api_ids(basho_id: str) -> list[int]:
    """sumo-api ids of `basho_id`'s Makuuchi runners-up: the best win total among non-champions
    (ties all count). NotAvailable until the champion is recorded (a basho still under way)."""
    info = sumoapi._get(sumoapi.BASHO_URL.format(basho_id=basho_id))
    champs = {int(y["rikishiId"]) for y in info.get("yusho") or []
              if y.get("type") == "Makuuchi" and y.get("rikishiId")}
    if not champs:
        raise NotAvailable(f"no Makuuchi yusho recorded for {basho_id}")
    payload = sumoapi._get(sumoapi.BANZUKE_URL.format(basho_id=basho_id, division="Makuuchi"))
    others = [r for side in ("east", "west") for r in payload.get(side) or []
              if r.get("rikishiID") and int(r["rikishiID"]) not in champs]
    if not others:
        return []
    best = max(int(r.get("wins") or 0) for r in others)
    return sorted(int(r["rikishiID"]) for r in others if int(r.get("wins") or 0) == best)


def add_jun_yusho(profiles: list[dict], jun_yusho: dict[str, set[int]]) -> None:
    """Prepend the jun-yusho label to each Makuuchi history row whose basho in `jun_yusho`
    ({basho id: sumo.or.jp ids}) names that profile's rikishi."""
    for profile in profiles:
        for row in profile.get("history") or []:
            if (row.get("division") == "Makuuchi" and JUN_YUSHO_LABEL not in row["achievements"]
                    and profile["rikishi_id"] in jun_yusho.get(_history_basho_id(row), ())):
                row["achievements"].insert(0, JUN_YUSHO_LABEL)


def _jun_yusho_by_basho(data_dir: Path, profiles: list[dict]) -> dict[str, set[int]]:
    """{basho id: sumo.or.jp ids of its jun-yusho} for every Makuuchi basho in `profiles`' histories.

    The cache holds sumo-api ids (retired rikishi have no nskId in the active list); only basho
    missing from it are fetched, and one that fails (or is still under way) is just left out.
    """
    cache_path = data_dir / "jun_yusho.json"
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        cache = {}
    wanted = {_history_basho_id(row) for p in profiles for row in p.get("history") or []
              if row.get("division") == "Makuuchi"} - {None}
    fetched = 0
    for basho_id in sorted(wanted - cache.keys()):
        try:
            cache[basho_id] = _jun_yusho_api_ids(basho_id)
            fetched += 1
        except (NotAvailable, requests.RequestException, ValueError, KeyError) as e:
            log(f"warning: no jun-yusho for {basho_id} ({e})")
    if fetched:
        write_json(cache_path, dict(sorted(cache.items())))
    nsk = sumoapi.nsk_ids()
    return {b: {nsk[i] for i in ids if i in nsk} for b, ids in cache.items()}


def write_profiles(data_dir: Path, basho: Basho) -> int:
    """Write public/data/profiles/{id}.json for every rikishi in `basho` that has a sumo.or.jp id."""
    shusshin = _shusshin_by_nsk()
    shikona_ja = _shikona_ja_by_nsk()
    out_dir = data_dir / "profiles"

    # First pass: build every profile (weight_class needs the whole cohort's weights).
    profiles = []
    for r in basho.rikishi:
        if not r.rikishi_id:
            continue
        try:
            profile = build_profile(r.rikishi_id, shusshin.get(r.rikishi_id))
        except (requests.RequestException, ValueError) as e:
            log(f"warning: could not build profile for {r.name} ({r.rikishi_id}): {e}")
            continue
        if r.rikishi_id in shikona_ja:
            # Insert shikona_ja immediately after shikona
            ordered: dict = {}
            for k, v in profile.items():
                ordered[k] = v
                if k == "shikona":
                    ordered["shikona_ja"] = shikona_ja[r.rikishi_id]
            profile = ordered
        profiles.append((profile, r.division != "makushita"))

    # Second pass: prepend the weight class, relative to the sekitori (Makuuchi and Juryo), onto
    # each style, then write.
    classes = _weight_classes([p.get("weight_kg") for p, _ in profiles], [sekitori for _, sekitori in profiles])
    profiles = [p for p, _ in profiles]
    add_jun_yusho(profiles, _jun_yusho_by_basho(data_dir, profiles))
    for profile, weight_class in zip(profiles, classes):
        profile["style"] = {"weight_class": weight_class, **profile.get("style", {})}
        write_json(out_dir / f"{profile['rikishi_id']}.json", profile)
    log(f"wrote {len(profiles)} profiles to {out_dir}")
    return len(profiles)
