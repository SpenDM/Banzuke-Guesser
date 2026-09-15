import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { idealPlacements, netScore } from '../../public/js/promote.js';
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
const ideal = (basho, placed = new Map()) => idealPlacements(basho, placed, new GuessState(basho).rowCounts);

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
  const p = ideal(makeBasho({
    M1E: rec(9, 6), M2W: rec(10, 5), J1E: rec(8, 7), J3W: rec(12, 3), K1E: rec(10, 5),
    S1E: rec(12, 3), S2W: rec(9, 6), S2E: rec(8, 7), M1W: rec(15, 0),
  }));
  assert.equal(p.get('m1e'), '^K');
  assert.equal(p.get('m2w'), '^K');  // +5 from M2W reaches Ozeki on the ladder, but is still a Komusubi candidate
  assert.equal(p.get('m1w'), '^K');
  assert.equal(p.get('j1e'), '^M');
  assert.equal(p.get('j3w'), '^M');
  assert.equal(p.get('k1e'), '^S');
  assert.equal(p.get('s1e'), 'S1E');  // 12-3 at S1E would be Ozeki
  assert.equal(p.get('s2w'), 'S1E');  // +3 from S2W is past S1E
  assert.equal(p.get('s2e'), 'S1E');  // +1 from S2E lands exactly on S1E
});

test('demotions cross into the next type down the same way the Change column counts them', () => {
  const p = ideal(makeBasho({ K1W: rec(5, 10), S1W: rec(6, 9), M17W: rec(6, 9), M16E: rec(0, 0, 15), J14W: rec(3, 12) }));
  assert.equal(p.get('k1w'), 'M5W');   // -5 = 10 half steps: K1W -> M1E is the first
  assert.equal(p.get('s1w'), 'M1W');   // -3: S2E, S2W, K1E, K1W, M1E, M1W
  assert.equal(p.get('m17w'), 'J3W');
  assert.equal(p.get('j14w'), 'J14W'); // off the bottom of Juryo: lowest Juryo slot
  assert.equal(p.get('m16e'), 'J14E'); // full absence: -15 from M16E
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
  const s = new GuessState(makeBasho({ M1E: rec(9, 6) }));
  s.place('m2e', 'M1E');
  s.applyIdealPromotions();
  assert.equal(s.slotOf('m2e'), 'M1E');
  assert.equal(s.slotOf('m1e'), '^K');
  assert.equal(s.counts().unplaced, 0);
  const rows = s.rows();
  const kRows = rows.filter((r) => r.rank === 'K');
  assert.deepEqual(kRows.at(-1), { rank: 'K', candidates: true });
  assert.equal(rows.some((r) => r.rank === 'S' && r.candidates), false);
  s.place('m1e', 'K1E');
  assert.equal(s.rows().some((r) => r.candidates), false);
  // round-trips through the snapshot
  const b = new GuessState(makeBasho({ M1E: rec(9, 6) }));
  s.place('m1e', '^K');
  b.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(b.slotOf('m1e'), '^K');
});
