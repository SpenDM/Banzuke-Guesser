"""Tournament schedule from https://www.sumo.or.jp/EnTicket/year_schedule/ (server-rendered HTML)."""
from __future__ import annotations

import re
from datetime import date, datetime

from bs4 import BeautifulSoup

from .http import session
from .model import Tournament

SCHEDULE_URL = "https://www.sumo.or.jp/EnTicket/year_schedule/"
_DATE_RE = re.compile(r"[A-Z][a-z]+ \d{1,2}, \d{4}")


def _parse_date(text: str) -> date:
    return datetime.strptime(text.strip(), "%B %d, %Y").date()


def parse_schedule(html: str) -> list[Tournament]:
    soup = BeautifulSoup(html, "html.parser")
    tournaments: list[Tournament] = []
    for table in soup.select("table.mdTable4"):
        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if len(cells) < 5:
                continue
            venue = cells[1].get_text(" ", strip=True)
            banzuke = _parse_date(cells[3].get_text(strip=True))
            days = _DATE_RE.findall(cells[4].get_text(" ", strip=True))
            if len(days) != 2:
                continue
            start, end = _parse_date(days[0]), _parse_date(days[1])
            basho_id = Tournament.id_for(start)
            tournaments.append(Tournament(
                id=basho_id,
                name=Tournament.name_for(basho_id),
                venue=venue,
                banzuke_date=banzuke.isoformat(),
                start_date=start.isoformat(),
                end_date=end.isoformat(),
            ))
    tournaments.sort(key=lambda t: t.id)
    return tournaments


def fetch_schedule() -> list[Tournament]:
    resp = session().get(SCHEDULE_URL, timeout=30)
    resp.raise_for_status()
    tournaments = parse_schedule(resp.text)
    if not tournaments:
        raise RuntimeError("schedule page parsed to zero tournaments; markup may have changed")
    return tournaments


def latest_finished(schedule: list[Tournament], today: date) -> Tournament | None:
    """Most recent tournament whose final day is strictly before `today`."""
    done = [t for t in schedule if date.fromisoformat(t.end_date) < today]
    return max(done, key=lambda t: t.id) if done else None
