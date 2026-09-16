from scraper.annotate import annotate, jun_yusho_keys
from scraper.model import Basho, RikishiRow, previous_id


def row(key, rank, num=1, side="E", wins=8, losses=7, absences=0):
    return RikishiRow(key=key, name=key.title(), rank=rank, num=num, side=side,
                      wins=wins, losses=losses, absences=absences)


def basho(rows):
    return Basho(id="202607", name="July 2026", start_date="2026-07-12", end_date="2026-07-26",
                 source="test", rikishi=rows)


def by_key(b):
    return {r.key: r for r in b.rikishi}


def test_previous_id_steps_back_two_months_and_wraps_the_year():
    assert previous_id("202607") == "202605"
    assert previous_id("202601") == "202511"
    assert previous_id("202603") == "202601"


def test_jun_yusho_is_every_non_champion_with_the_best_record():
    rows = [row("a", "O", wins=12), row("b", "K", wins=12), row("c", "M", wins=12), row("d", "M", wins=11),
            row("j", "J", wins=14)]
    assert jun_yusho_keys(rows, {"b"}) == {"a", "c"}
    assert jun_yusho_keys(rows, set()) == {"a", "b", "c"}


def test_yusho_marks_both_division_champions():
    b = basho([row("a", "M", wins=13), row("j", "J", wins=12), row("x", "M")])
    annotate(b, None, None, {"a", "j"}, set())
    assert [r.key for r in b.rikishi if r.yusho] == ["a", "j"]


def test_kadoban_and_tsunatori_need_an_ozeki_result_last_basho():
    b = basho([row("kado", "O", wins=8), row("tsuna", "O", 1, "W", wins=12), row("junner", "O", 2, wins=12),
               row("newozeki", "O", 2, "W", wins=10)])
    prev = [row("kado", "O", wins=3, losses=9, absences=3), row("tsuna", "O", 1, "W", wins=14),
            row("junner", "O", 2, wins=12), row("newozeki", "S", wins=11), row("m", "M", wins=12)]
    annotate(b, prev, None, set(), {"tsuna"})
    k = by_key(b)
    assert k["kado"].kadoban and not k["kado"].tsunatori
    assert k["tsuna"].tsunatori and not k["tsuna"].kadoban
    assert k["junner"].tsunatori  # 12-3 jun-yusho behind the 14-1 champion
    assert not k["newozeki"].kadoban and not k["newozeki"].tsunatori  # was Sekiwake last basho


def test_ozeki_run_counts_sekiwake_or_komusubi_basho_and_needs_18_wins():
    b = basho([row("run", "S"), row("short", "S", 1, "W"), row("fresh", "S", 2), row("komusubi", "K", wins=11)])
    prev1 = [row("run", "S", wins=9), row("short", "S", 1, "W", wins=9), row("fresh", "S", 2, wins=11),
             row("komusubi", "K", wins=12)]
    prev2 = [row("run", "K", wins=9), row("short", "K", wins=8), row("fresh", "M", 3, wins=11),
             row("komusubi", "K", wins=12)]
    annotate(b, prev1, prev2, set(), set())
    k = by_key(b)
    assert k["run"].ozeki_run == 18
    assert k["short"].ozeki_run is None    # 17 prior wins
    assert k["fresh"].ozeki_run is None    # Maegashira two basho ago
    assert k["komusubi"].ozeki_run is None  # must be Sekiwake now


def test_ozeki_return_is_a_sekiwake_who_was_ozeki_last_basho():
    b = basho([row("back", "S", wins=12), row("other", "S", 1, "W")])
    prev1 = [row("back", "O", wins=0, losses=0, absences=15), row("other", "S", 1, "W")]
    annotate(b, prev1, None, {"back"}, set())
    k = by_key(b)
    assert k["back"].ozeki_return and k["back"].yusho
    assert not k["other"].ozeki_return


def test_annotate_resets_stale_flags_and_survives_missing_history():
    r = row("a", "O")
    r.kadoban = r.tsunatori = r.yusho = True
    r.ozeki_run = 20
    b = basho([r])
    annotate(b, None, None, set(), set())
    assert (r.kadoban, r.tsunatori, r.yusho, r.ozeki_run, r.ozeki_return) == (False, False, False, None, False)


def test_basho_round_trips_through_to_dict_and_from_dict():
    r = row("a", "S", wins=12)
    r.ozeki_run = 21
    r.yusho = True
    b = basho([r, row("b", "J", 3, "W")])
    b.next = {"id": "202609"}
    d = b.to_dict()
    back = Basho.from_dict(d)
    assert back.to_dict() == d
    assert back.rikishi[0].ozeki_run == 21 and back.rikishi[0].yusho
