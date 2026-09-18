from datetime import date

from scraper.schedule import latest_announced, latest_finished, parse_schedule


def test_parse_schedule_extracts_every_tournament(fixture_text):
    sched = parse_schedule(fixture_text("year_schedule.html"))
    assert len(sched) == 18  # three years × six basho
    first = sched[0]
    assert first.id == "202601"
    assert first.name == "January 2026"
    assert first.venue == "Kokugikan"
    assert first.banzuke_date == "2025-12-22"
    assert first.start_date == "2026-01-11"
    assert first.end_date == "2026-01-25"
    sept = next(t for t in sched if t.id == "202609")
    assert (sept.banzuke_date, sept.start_date, sept.end_date) == ("2026-08-31", "2026-09-13", "2026-09-27")
    assert [t.id for t in sched] == sorted(t.id for t in sched)


def test_latest_finished_picks_most_recent_completed(fixture_text):
    sched = parse_schedule(fixture_text("year_schedule.html"))
    assert latest_finished(sched, date(2026, 9, 15)).id == "202607"
    assert latest_finished(sched, date(2026, 9, 27)).id == "202607"  # final day itself: not finished
    assert latest_finished(sched, date(2026, 9, 28)).id == "202609"
    assert latest_finished(sched, date(2026, 1, 1)) is None


def test_latest_announced_includes_the_announcement_day(fixture_text):
    sched = parse_schedule(fixture_text("year_schedule.html"))
    assert latest_announced(sched, date(2026, 8, 30)).id == "202607"
    assert latest_announced(sched, date(2026, 8, 31)).id == "202609"  # announced that day
    assert latest_announced(sched, date(2026, 10, 25)).id == "202609"
    assert latest_announced(sched, date(2026, 10, 26)).id == "202611"
    assert latest_announced(sched, date(2025, 1, 1)) is None
