from pathlib import Path

from scraper.model import Basho, RikishiRow, make_key, update_index, write_basho


def test_make_key_normalises_shikona():
    assert make_key("Onosato") == "onosato"
    assert make_key("Ōnosato") == "onosato"
    assert make_key("Kotozakura Masakatsu") == "kotozakura-masakatsu"


def test_write_basho_and_index(tmp_path: Path):
    row = RikishiRow(key="x", name="X", rank="M", num=1, side="E", wins=8, losses=7, absences=0)
    write_basho(tmp_path, Basho("202607", "July 2026", "2026-07-12", "2026-07-26", "test", [row]))
    write_basho(tmp_path, Basho("202609", "September 2026", "2026-09-13", "2026-09-27", "test", [row]))
    update_index(tmp_path)
    import json
    idx = json.loads((tmp_path / "index.json").read_text())
    assert idx == {"latest": "202609", "basho": ["202607", "202609"]}
