from scraper.annotate import annotate, jun_yusho_keys, match_previous, yusho_keys_in
from scraper.model import Basho, RikishiRow, previous_id


def row(key, rank, num=1, side="E", wins=8, losses=7, absences=0, rikishi_id=None):
    return RikishiRow(key=key, name=key.title(), rank=rank, num=num, side=side,
                      wins=wins, losses=losses, absences=absences, rikishi_id=rikishi_id)


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
    # tsuna's run started with an outright win last basho, junner's with only a tie for one.
    assert not k["tsuna"].tsunatori_needs_yusho
    assert k["junner"].tsunatori_needs_yusho
    # This basho nobody has an outright yusho (yusho_keys=set()), so the two tied at 12-3 are jun-yusho.
    assert k["tsuna"].jun_yusho and k["junner"].jun_yusho
    assert not k["kado"].jun_yusho and not k["newozeki"].jun_yusho


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


def test_match_previous_prefers_rikishi_id_and_falls_back_to_key():
    prev = [row("kiribayama", "S", rikishi_id=7), row("same", "M", rikishi_id=8), row("noid", "M", 2)]
    rows = [row("kirishima", "O", rikishi_id=7), row("same", "M", rikishi_id=8), row("noid", "M", 2),
            row("stranger", "M", 3, rikishi_id=99), row("rookie", "J")]
    m = match_previous(rows, prev)
    assert m["kirishima"].key == "kiribayama"    # renamed: found by id despite the new key
    assert m["same"].key == "same"
    assert m["noid"].key == "noid"               # no id on either side: by key
    assert "stranger" not in m and "rookie" not in m
    assert match_previous(rows, None) == {}


def test_yusho_keys_in_maps_winners_to_rows_by_id_then_key():
    rows = [row("kiribayama", "S", rikishi_id=7), row("plain", "M"), row("j", "J")]
    # sumo-api names the champion by their current shikona; the id is what finds the row.
    winners = [(7, "kirishima"), (None, "j"), (123, "nobody")]
    assert yusho_keys_in(rows, winners) == {"kiribayama", "j"}
    assert yusho_keys_in(None, winners) == set() and yusho_keys_in(rows, None) == set()


def test_indicators_survive_a_shikona_change():
    # Kiribayama went up on an Ozeki run, was promoted and renamed Kirishima; a fresh Ozeki
    # who was Ozeki last basho under another name is kadoban / tsunatori all the same.
    b = basho([row("kirishima", "O", wins=10, rikishi_id=7), row("kotozakura", "S", wins=11, rikishi_id=9),
               row("ex", "S", 1, "W", wins=9, rikishi_id=11)])
    prev1 = [row("kiribayama", "O", wins=6, losses=9, rikishi_id=7), row("kotonowaka", "S", wins=11, rikishi_id=9),
             row("oldex", "O", 2, wins=4, losses=11, rikishi_id=11)]
    prev2 = [row("kotonowaka", "K", wins=9, rikishi_id=9)]
    annotate(b, prev1, prev2, set(), {"kiribayama"})
    k = by_key(b)
    assert k["kirishima"].kadoban and k["kirishima"].tsunatori   # 6-9 and the yusho last basho
    assert k["kotozakura"].ozeki_run == 20
    assert k["ex"].ozeki_return


def test_annotate_resets_stale_flags_and_survives_missing_history():
    r = row("a", "O")
    r.kadoban = r.tsunatori = r.yusho = r.tsunatori_needs_yusho = True
    r.ozeki_run = 20
    b = basho([r])
    annotate(b, None, None, set(), set())
    assert (r.kadoban, r.tsunatori, r.yusho, r.ozeki_run, r.ozeki_return, r.tsunatori_needs_yusho) == (
        False, False, False, None, False, False)


def test_in_progress_basho_has_no_jun_yusho_yet():
    b = basho([row("a", "O", wins=10, losses=2), row("b", "M", wins=9, losses=3)])
    b.in_progress = True
    annotate(b, None, None, set(), set())
    assert not any(r.jun_yusho or r.yusho for r in b.rikishi)


def test_in_progress_round_trips_and_is_left_out_of_finished_basho():
    b = basho([row("a", "M", wins=3, losses=2)])
    assert "in_progress" not in b.to_dict()
    b.in_progress = True
    d = b.to_dict()
    assert d["in_progress"] is True and Basho.from_dict(d).in_progress


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
