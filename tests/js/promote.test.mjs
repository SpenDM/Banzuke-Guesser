import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { idealPlacements, netScore, ozekiRunNeeded } from '../../public/js/promote.js';
import { GuessState } from '../../public/js/state.js';

// Y1, O1, S1-2, K1, M1-17, J1-14, every slot filled with a 7-8 nobody (net -1) unless overridden.
function makeBasho(overrides = {}) {
  const counts = { Y: 1, O: 1, S: 2, K: 1, M: 17, J: 14 };
  const rikishi = [];
  for (const [rank, count] of Object.entries(counts)) {
    for (let num = 1; num <= count; num++) for (const side of ['E', 'W']) {
      const key = `${rank}${num}${side}`.toLowerCase();
      rikishi.push({
        key, name: key, rank, num, side, wins: 7, losses: 8, absences: 0, retired: false,
        division: rank === 'J' ? 'juryo' : 'makuuchi', ...(overrides[key.toUpperCase()] || {}),
      });
    }
  }
  return { id: '202607', rikishi };
}
const rec = (wins, losses, absences = 0) => ({ wins, losses, absences });
const ideal = (basho, placed = new Map()) => idealPlacements(basho, placed, new GuessState(basho).rowCounts).placements;

test('net score counts absences as losses', () => {
  assert.equal(netScore(rec(9, 6)), 3);
  assert.equal(netScore(rec(7, 7, 1)), -1);
  assert.equal(netScore(rec(0, 0, 15)), -15);
});

test('moves within a rank type by one number per point, E/W being a half step', () => {
  const p = ideal(makeBasho({ M5E: rec(9, 6), M5W: rec(9, 6), M2E: rec(6, 9), M8W: rec(8, 7), M3E: rec(7, 8) }));
  assert.equal(p.get('m5e'), 'M2E');
  assert.equal(p.get('m5w'), 'M2W');
  assert.equal(p.get('m2e'), 'M5E');
  assert.equal(p.get('m8w'), 'M7W');
  assert.equal(p.get('m3e'), 'M4E');
});

test('rising into a higher type goes to the candidates row for the type above; Sekiwake are capped at S1E', () => {
  // M3/M4/M5, not M1/M2, so none of these trip the M1/M2 force-promotion rule (tested separately).
  const p = ideal(makeBasho({
    M3E: rec(9, 6), M4W: rec(10, 5), J1E: rec(8, 7), J3W: rec(12, 3), K1E: rec(10, 5),
    S1E: rec(12, 3), S2W: rec(9, 6), S2E: rec(8, 7), M5W: rec(15, 0),
  }));
  assert.equal(p.get('m3e'), '^K');
  assert.equal(p.get('m4w'), '^K');  // +5 from M4W reaches Ozeki on the ladder, but is still a Komusubi candidate
  assert.equal(p.get('m5w'), '^K');
  assert.equal(p.get('j1e'), '^M');
  assert.equal(p.get('j3w'), '^M');
  assert.equal(p.get('k1e'), '^S');
  assert.equal(p.get('s1e'), 'S1E');  // 12-3 at S1E would be Ozeki
  assert.equal(p.get('s2w'), 'S1E');  // +3 from S2W is past S1E
  assert.equal(p.get('s2e'), 'S1E');  // +1 from S2E lands exactly on S1E
});

test('demotions cross into the next type down the same way the Change column counts them', () => {
  const p = ideal(makeBasho({ K1W: rec(5, 10), S1W: rec(6, 9), J2E: rec(5, 10), J14W: rec(3, 12) }));
  assert.equal(p.get('k1w'), 'M5W');   // -5 = 10 half steps: K1W -> M1E is the first
  assert.equal(p.get('s1w'), 'M1W');   // -3: S2E, S2W, K1E, K1W, M1E, M1W
  assert.equal(p.get('j2e'), 'J7E');   // -5 = 10 half steps
  assert.equal(p.get('j14w'), 'J14W'); // off the bottom of Juryo: lowest Juryo slot
});

test('Makuuchi rikishi who would drop into Juryo become demotion candidates instead', () => {
  const p = ideal(makeBasho({ M17W: rec(6, 9), M16E: rec(0, 0, 15), M15E: rec(2, 13), M16W: rec(7, 8) }));
  assert.equal(p.get('m17w'), 'vJ');
  assert.equal(p.get('m16e'), 'vJ');   // full absence: way off the bottom
  assert.equal(p.get('m15e'), 'vJ');
  assert.equal(p.get('m17e'), 'vJ');   // -1 from M17E is J1E
  assert.equal(p.get('m16w'), 'M17W'); // -1 from M16W stays in Maegashira
});

test('Yokozuna and Ozeki are re-ordered within their rank by wins, previous order breaking ties', () => {
  const basho = makeBasho({ Y1E: rec(7, 7, 1), Y1W: rec(9, 6), O1E: rec(8, 7), O1W: rec(8, 7) });
  const p = ideal(basho);
  assert.equal(p.get('y1w'), 'Y1E');
  assert.equal(p.get('y1e'), 'Y1W');
  assert.equal(p.get('o1e'), 'O1E');
  assert.equal(p.get('o1w'), 'O1W');
});

test('already-placed rikishi are untouched and their slots are skipped for Yokozuna/Ozeki; retired rikishi stay unplaced', () => {
  const basho = makeBasho({ Y1E: rec(7, 7, 1), Y1W: rec(9, 6), M4E: { retired: true, ...rec(10, 5) } });
  const placed = new Map([['y1e', 'Y1E'], ['m5e', 'M9W']]);
  const p = ideal(basho, placed);
  assert.equal(p.has('y1e'), false);
  assert.equal(p.has('m5e'), false);
  assert.equal(p.get('y1w'), 'Y1W');
  assert.equal(p.has('m4e'), false);
});

test('GuessState.applyIdealPromotions places everyone and shows a candidates row only while occupied', () => {
  // M3+, not M1/M2, so these candidates don't trip the M1/M2 force-promotion rule (tested separately).
  const s = new GuessState(makeBasho({ M3E: rec(9, 6) }));
  s.place('m2e', 'M1E');
  s.applyIdealPromotions();
  assert.equal(s.slotOf('m2e'), 'M1E');
  assert.equal(s.slotOf('m3e'), '^K');
  // candidates are listed in previous-banzuke order, not by score
  const t = new GuessState(makeBasho({ M3E: rec(9, 6), M4W: rec(12, 3), M3W: rec(10, 5) }));
  t.applyIdealPromotions();
  assert.deepEqual(t.occupants('^K').map((r) => r.key), ['m3e', 'm3w', 'm4w']);
  const rows = s.rows();
  const kRows = rows.filter((r) => r.rank === 'K');
  assert.deepEqual(kRows.at(-1), { rank: 'K', candidates: true });
  assert.equal(rows.some((r) => r.rank === 'S' && r.candidates), false);
  s.place('m3e', 'K1E');
  assert.equal(s.rows().some((r) => r.rank === 'K' && r.candidates), false);
  // the Maegashira row is shown for either half, and sits right before Juryo
  const d = new GuessState(makeBasho());
  d.place('m17w', 'vJ');
  const mRows = d.rows();
  assert.deepEqual(mRows[mRows.findIndex((r) => r.rank === 'J') - 1], { rank: 'M', candidates: true });
  d.remove('m17w');
  assert.equal(d.rows().some((r) => r.candidates), false);
  // round-trips through the snapshot
  const b = new GuessState(makeBasho({ M3E: rec(9, 6) }));
  s.place('m3e', '^K');
  b.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(b.slotOf('m3e'), '^K');
});

test('a kadoban Ozeki with a make-koshi drops to the first open Sekiwake slot; a kachi-koshi keeps the rank', () => {
  const p = ideal(makeBasho({ O1E: { kadoban: true, ...rec(7, 8) }, O1W: { kadoban: true, ...rec(8, 7) }, S1E: rec(9, 6) }));
  assert.equal(p.get('o1w'), 'O1E');
  assert.equal(p.get('o1e'), 'S1W');  // S1E is taken by the 9-6 Sekiwake's score placement
  // both Sekiwake slots of a one-row Sekiwake taken: a row is added
  const basho = makeBasho({ O1E: { kadoban: true, ...rec(5, 10) }, S1E: rec(7, 8), S1W: rec(7, 8), S2E: rec(9, 6), S2W: rec(8, 7) });
  const s = new GuessState(basho);
  s.applyIdealPromotions();
  assert.equal(s.rowCounts.S, 3);
  assert.equal(s.slotOf('o1e'), 'S3E');
});

test('an Ozeki on a Yokozuna run is promoted only with the yusho, after the sitting Yokozuna', () => {
  const won = ideal(makeBasho({ O1E: { tsunatori: true, yusho: true, ...rec(13, 2) }, Y1E: rec(10, 5), Y1W: rec(12, 3) }));
  assert.equal(won.get('y1w'), 'Y1E');
  assert.equal(won.get('y1e'), 'Y1W');
  assert.equal(won.get('o1e'), 'Y2E');  // no Yokozuna slot was open: Y2 added
  const lost = ideal(makeBasho({ O1E: { tsunatori: true, ...rec(13, 2) } }));
  assert.equal(lost.get('o1e'), 'O1E');
  const s = new GuessState(makeBasho({ O1E: { tsunatori: true, yusho: true, ...rec(13, 2) } }));
  s.applyIdealPromotions();
  assert.equal(s.rowCounts.Y, 2);
  assert.equal(s.slotOf('o1e'), 'Y2E');
  assert.equal(s.slotOf('o1w'), 'O1E');
});

test('a jun-yusho (tie with the champion) also completes a Yokozuna run, unless last basho was already a jun-yusho', () => {
  // Last basho was an outright win: a tie this basho is enough. (Y1E/Y1W default to a 7-8
  // nobody each, so, as in the yusho case above, the promoted Ozeki lands on the added Y2 row.)
  const tiedAfterWin = ideal(makeBasho({ O1E: { tsunatori: true, jun_yusho: true, ...rec(13, 2) } }));
  assert.equal(tiedAfterWin.get('o1e'), 'Y2E');
  // Last basho was itself only a jun-yusho: a second straight tie doesn't complete the run.
  const tiedTwice = ideal(makeBasho({
    O1E: { tsunatori: true, tsunatori_needs_yusho: true, jun_yusho: true, ...rec(13, 2) },
  }));
  assert.equal(tiedTwice.get('o1e'), 'O1E');
  // Same case, but this basho is an outright win instead of a tie: still completes it.
  const wonAfterTie = ideal(makeBasho({
    O1E: { tsunatori: true, tsunatori_needs_yusho: true, yusho: true, ...rec(13, 2) },
  }));
  assert.equal(wonAfterTie.get('o1e'), 'Y2E');
});

test('Sekiwake completing an Ozeki run or regaining Ozeki move to the next open Ozeki slot, returnee first', () => {
  assert.equal(ozekiRunNeeded({ ozeki_run: 21 }), 12);
  assert.equal(ozekiRunNeeded({}), null);
  const basho = makeBasho({
    S1E: { ozeki_run: 21, ...rec(12, 3) },        // 33 reached
    S1W: { ozeki_run: 20, ...rec(12, 3) },        // one short: stays on the score system, capped at S1E
    S2W: { ozeki_return: true, ...rec(10, 5) },   // 10 wins regain Ozeki
    S2E: { ozeki_return: true, ...rec(9, 6) },    // 9 do not
    O1E: rec(8, 7), O1W: rec(9, 6),
  });
  const s = new GuessState(basho);
  s.applyIdealPromotions();
  assert.equal(s.rowCounts.O, 2);
  assert.equal(s.slotOf('o1w'), 'O1E');
  assert.equal(s.slotOf('o1e'), 'O1W');
  assert.equal(s.slotOf('s2w'), 'O2E');
  assert.equal(s.slotOf('s1e'), 'O2W');
  assert.equal(s.slotOf('s1w'), 'S1E');
  assert.equal(s.slotOf('s2e'), 'S1E');  // +3 from S2E is past the top of Sekiwake: capped
  // slots the user already filled are skipped, and the row count is not grown needlessly
  const t = new GuessState(makeBasho({ S1E: { ozeki_run: 21, ...rec(12, 3) } }));
  t.addRow('O');
  t.place('o1e', 'O1E');
  t.applyIdealPromotions();
  assert.equal(t.rowCounts.O, 2);
  assert.equal(t.slotOf('o1w'), 'O1W');
  assert.equal(t.slotOf('s1e'), 'O2E');
});

test('a Komusubi with 11+ wins forces a new Sekiwake slot even when both existing slots are filled', () => {
  const p = ideal(makeBasho({ K1E: rec(11, 4), S1E: rec(7, 7), S1W: rec(7, 7), S2E: rec(7, 7), S2W: rec(7, 7) }));
  assert.equal(p.get('k1e'), 'S3E');  // both S rows already filled by the score placements: S3 is added
  // 10 wins is not enough: stays on the score system as a candidate
  const short = ideal(makeBasho({ K1E: rec(10, 5) }));
  assert.equal(short.get('k1e'), '^S');
  const s = new GuessState(makeBasho({ K1W: rec(12, 3), O1E: { kadoban: true, ...rec(5, 10) } }));
  s.applyIdealPromotions();
  assert.equal(s.rowCounts.S, 2);
  assert.equal(s.slotOf('o1e'), 'S1E');   // the demoted Ozeki fills the open slot first
  assert.equal(s.slotOf('k1w'), 'S1W');   // the force-promoted Komusubi takes the other
});

test('an M1 with 8+ wins or an M2 with 10+ wins forces a new Komusubi slot', () => {
  const p = ideal(makeBasho({ M1E: rec(8, 7), K1E: rec(7, 7), K1W: rec(7, 7) }));
  assert.equal(p.get('m1e'), 'K2E');  // both K slots already taken by the score placements: K2 is added
  // 7 wins at M1 is not enough to force, but still enough to rise into the candidates row
  const shortM1 = ideal(makeBasho({ M1E: rec(7, 6) }));
  assert.equal(shortM1.get('m1e'), '^K');
  // M2 needs 10, not 8
  const m2met = ideal(makeBasho({ M2E: rec(10, 5) }));
  assert.equal(m2met.get('m2e'), 'K2E');
  const m2short = ideal(makeBasho({ M2E: rec(9, 6) }));
  assert.equal(m2short.get('m2e'), '^K');
});

test('retired rikishi are skipped even when an indicator would move them', () => {
  const p = ideal(makeBasho({ O1E: { retired: true, tsunatori: true, yusho: true, ...rec(13, 2) }, Y1E: { retired: true, ...rec(0, 0, 15) } }));
  assert.equal(p.has('o1e'), false);
  assert.equal(p.has('y1e'), false);
  assert.equal(p.get('y1w'), 'Y1E');
});
