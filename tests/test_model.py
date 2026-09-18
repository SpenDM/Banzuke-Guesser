import json
from pathlib import Path

from scraper.model import Basho, RikishiRow, banzuke_exists, make_key, update_index, write_banzuke, write_basho


def test_make_key_normalises_shikona():
    assert make_key("Onosato") == "onosato"
    assert make_key("Ōnosato") == "onosato"
    assert make_key("Kotozakura Masakatsu") == "kotozakura-masakatsu"


def test_write_basho_and_index(tmp_path: Path):
    row = RikishiRow(key="x", name="X", rank="M", num=1, side="E", wins=8, losses=7, absences=0)
    write_basho(tmp_path, Basho("202607", "July 2026", "2026-07-12", "2026-07-26", "test", [row]))
    write_basho(tmp_path, Basho("202609", "September 2026", "2026-09-13", "2026-09-27", "test", [row]))
    update_index(tmp_path)
    idx = json.loads((tmp_path / "index.json").read_text())
    assert idx == {"latest": "202609", "basho": ["202607", "202609"]}


def test_write_banzuke_keeps_makuuchi_slots_only(tmp_path: Path):
    rows = [RikishiRow(key="a", name="A", rank="Y", num=1, side="E", wins=0, losses=0, absences=0, rikishi_id=1),
            RikishiRow(key="b", name="B", rank="M", num=1, side="W", wins=0, losses=0, absences=0),
            RikishiRow(key="j", name="J", rank="J", num=1, side="E", wins=0, losses=0, absences=0, rikishi_id=3)]
    basho = Basho(id="202609", name="September 2026", start_date="2026-09-13", end_date="2026-09-27",
                  source="test", rikishi=rows)
    path = write_banzuke(tmp_path, basho, "2026-08-31")
    assert path == tmp_path / "banzuke" / "202609.json" and banzuke_exists(tmp_path, "202609")
    d = json.loads(path.read_text())
    assert d["banzuke_date"] == "2026-08-31"
    assert d["rikishi"] == [
        {"key": "a", "name": "A", "rank": "Y", "num": 1, "side": "E", "rikishi_id": 1},
        {"key": "b", "name": "B", "rank": "M", "num": 1, "side": "W", "rikishi_id": None},
    ]
