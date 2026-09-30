import json

from scraper import juryo
from scraper.model import Basho, RikishiRow, read_basho, update_index, write_basho


def test_kanji_numbers():
    assert [juryo.kanji_number(t) for t in ("八", "十", "十一", "二十", "二十三", "9", "１２")] == [8, 10, 11, 20, 23, 9, 12]


def test_parse_announcement(fixture_text):
    a = juryo.parse_announcement(fixture_text("shin_juryo.html"))
    assert a == {
        "basho_id": "202611",  # 令和八年十一月場所
        "announced": "2026-09-30",
        "rikishi": [{"shikona": "旭富士", "reading": "あさひふじ", "former": None},
                    {"shikona": "竜鳳", "reading": "りゅうほう", "former": None}],
    }


def test_parse_announcement_reads_a_former_shikona_and_every_list():
    table = ('<table><tr><th>しこ名</th><th>出身地</th><th>旧しこ名</th><th>備考</th></tr>'
             '<tr><td><span>{}</span><br>(よみ)</td><td>東京都<br>部屋</td><td>{}</td><td></td></tr></table>')
    html = f'<p>令和九年一月場所</p><p>令和8年11月26日発表</p>{table.format("新名", "旧名")}{table.format("再入", "")}'
    a = juryo.parse_announcement(html)
    assert (a["basho_id"], a["announced"]) == ("202701", "2026-11-26")
    assert a["rikishi"] == [{"shikona": "新名", "reading": "よみ", "former": "旧名"},
                            {"shikona": "再入", "reading": "よみ", "former": None}]
    assert juryo.parse_announcement("<p>nothing here</p>") is None


def row(key, num, rikishi_id):
    return RikishiRow(key=key, name=key.title(), rank="Ms", num=num, side="E", wins=4, losses=3, absences=0,
                      rikishi_id=rikishi_id)


def write(tmp_path, rows, next_id="202611"):
    basho = Basho(id="202609", name="September 2026", start_date="2026-09-13", end_date="2026-09-27",
                  source="test", rikishi=rows, next={"id": next_id})
    write_basho(tmp_path, basho)
    update_index(tmp_path)


ANNOUNCEMENT = {"basho_id": "202611", "announced": "2026-09-30",
                "rikishi": [{"shikona": "旭富士", "reading": None, "former": None},
                            {"shikona": "新名", "reading": None, "former": "竜鳳"}]}
NAMES = {1: {"旭富士"}, 2: {"竜鳳"}, 3: {"稲見"}}


def flagged(tmp_path):
    return sorted(r.key for r in read_basho(tmp_path, "202609").rikishi if r.juryo_promotion)


def test_apply_marks_the_announced_rikishi_by_japanese_shikona_current_or_former(tmp_path):
    write(tmp_path, [row("asahifuji", 1, 1), row("ryuho", 4, 2), row("inami", 25, 3)])
    assert juryo.apply(tmp_path, ANNOUNCEMENT, NAMES) == 0
    assert flagged(tmp_path) == ["asahifuji", "ryuho"]
    before = (tmp_path / "basho" / "202609.json").read_text()
    assert juryo.apply(tmp_path, ANNOUNCEMENT, NAMES) == 0  # already marked: the file is left alone
    assert (tmp_path / "basho" / "202609.json").read_text() == before


def test_apply_ignores_an_announcement_for_another_round(tmp_path):
    write(tmp_path, [row("asahifuji", 1, 1)], next_id="202609")
    assert juryo.apply(tmp_path, ANNOUNCEMENT, NAMES) == 0
    assert flagged(tmp_path) == []


def test_apply_fails_when_an_announced_rikishi_is_not_found(tmp_path):
    write(tmp_path, [row("asahifuji", 1, 1)])
    assert juryo.apply(tmp_path, ANNOUNCEMENT, NAMES) == 1
    assert flagged(tmp_path) == ["asahifuji"]  # the ones found are still marked
    assert json.loads((tmp_path / "basho" / "202609.json").read_text())["rikishi"][0]["juryo_promotion"] is True
