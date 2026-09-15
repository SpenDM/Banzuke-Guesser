import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { rankChange, parseSlot, compareSlots, buildLadder, DEFAULT_GUESS_ROWS } from '../../public/js/rank.js';

const s = (id) => parseSlot(id);

// A basho where every conventional row is filled: Y2, O3, S2, K2, M17, J14.
function fullBasho() {
  const counts = { Y: 2, O: 3, S: 2, K: 2, M: 17, J: 14 };
  const list = [];
  for (const [rank, count] of Object.entries(counts)) {
    for (let num = 1; num <= count; num++) for (const side of ['E', 'W']) list.push({ rank, num, side });
  }
  return list;
}

test('half-step moves within a rank type', () => {
  assert.equal(rankChange(s('M4W'), s('M4E')).text, '+0.5');
  assert.equal(rankChange(s('M4W'), s('M3W')).text, '+1.0');
  assert.equal(rankChange(s('M2E'), s('M6W')).text, '-4.5');
  assert.equal(rankChange(s('M2E'), s('M2E')).text, '0');
  assert.equal(rankChange(s('M2E'), s('M2E')).kind, 'same');
  assert.equal(rankChange(s('M2E'), s('M2E')).sub, null);
  assert.equal(rankChange(s('J3E'), s('J1W')).text, '+1.5');
  assert.equal(rankChange(s('O2E'), s('O1E')).text, '+1.0');
});

test('moves between rank types show the ORIGIN type plus a faint half-step count', () => {
  const ladder = buildLadder(fullBasho());
  const cases = [
    ['M1E', 'K1W', 'up', '↑M', '+1.5'],
    ['K1E', 'M3W', 'down', '↓K', '-4.5'],
    ['M16W', 'J1E', 'down', '↓M', '-1.5'],
    ['J2E', 'M15W', 'up', '↑J', '+3.5'],
    ['S2W', 'O1E', 'up', '↑S', '+4.5'],
    ['O1E', 'Y1W', 'up', '↑O', '+1.5'],
  ];
  for (const [from, to, kind, main, sub] of cases) {
    const c = rankChange(s(from), s(to), ladder);
    assert.equal(c.kind, kind, `${from}->${to} kind`);
    assert.equal(c.main, main, `${from}->${to} main`);
    assert.equal(c.sub, sub, `${from}->${to} sub`);
    assert.equal(c.text, `${main} ${sub}`, `${from}->${to} text`);
  }
});

test('a vacant row does not count toward the crossing distance', () => {
  const populated = buildLadder(fullBasho());
  const vacant = buildLadder(fullBasho().filter((r) => !(r.rank === 'S' && r.num === 2)));
  // With both Sekiwake rows filled, S1E -> K1E crosses the full Sekiwake width.
  assert.equal(rankChange(s('S1E'), s('K1E'), populated).sub, '-2.0');
  // With Sekiwake 2 empty, that row no longer adds to the distance.
  assert.equal(rankChange(s('S1E'), s('K1E'), vacant).sub, '-1.0');
});

test('without a ladder, a cross-type move has no numeric suffix', () => {
  const c = rankChange(s('M1E'), s('K1W'));
  assert.deepEqual(c, { text: '↑M', value: null, kind: 'up', main: '↑M', sub: null });
});

test('slot ordering follows the banzuke', () => {
  const ids = ['J1E', 'M17W', 'Y1W', 'O2E', 'M1E', 'Y1E', 'K1W', 'S1E'];
  const sorted = ids.map(parseSlot).sort(compareSlots).map((x) => `${x.rank}${x.num}${x.side}`);
  assert.deepEqual(sorted, ['Y1E', 'Y1W', 'O2E', 'S1E', 'K1W', 'M1E', 'M17W', 'J1E']);
});

test('default guess rows', () => {
  assert.equal(DEFAULT_GUESS_ROWS.length, 17 + 14);
  assert.deepEqual(DEFAULT_GUESS_ROWS[0], { rank: 'M', num: 1 });
  assert.deepEqual(DEFAULT_GUESS_ROWS.at(-1), { rank: 'J', num: 14 });
});
