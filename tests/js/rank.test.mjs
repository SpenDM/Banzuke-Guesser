import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { rankChange, parseSlot, compareSlots, DEFAULT_GUESS_ROWS } from '../../public/js/rank.js';

const s = (id) => parseSlot(id);

test('half-step moves within a rank type', () => {
  assert.equal(rankChange(s('M4W'), s('M4E')).text, '+0.5');
  assert.equal(rankChange(s('M4W'), s('M3W')).text, '+1.0');
  assert.equal(rankChange(s('M2E'), s('M6W')).text, '-4.5');
  assert.equal(rankChange(s('M2E'), s('M2E')).text, '0');
  assert.equal(rankChange(s('M2E'), s('M2E')).kind, 'same');
  assert.equal(rankChange(s('J3E'), s('J1W')).text, '+1.5');
  assert.equal(rankChange(s('O2E'), s('O1E')).text, '+1.0');
});

test('moves between rank types show the new type', () => {
  assert.deepEqual(rankChange(s('M1E'), s('K1W')), { text: '↑K', value: null, kind: 'up' });
  assert.equal(rankChange(s('K1E'), s('M3W')).text, '↓M');
  assert.equal(rankChange(s('M16W'), s('J1E')).text, '↓J');
  assert.equal(rankChange(s('J2E'), s('M15W')).text, '↑M');
  assert.equal(rankChange(s('S2W'), s('O1E')).text, '↑O');
  assert.equal(rankChange(s('O1E'), s('Y1W')).text, '↑Y');
});

test('slot ordering follows the banzuke', () => {
  const ids = ['J1E', 'M17W', 'Y1W', 'O2E', 'M1E', 'Y1E', 'K1W', 'S1E'];
  const sorted = ids.map(parseSlot).sort(compareSlots).map((x) => `${x.rank}${x.num}${x.side}`);
  assert.deepEqual(sorted, ['Y1E', 'Y1W', 'O2E', 'S1E', 'K1W', 'M1E', 'M17W', 'J1E']);
});

test('default guess rows', () => {
  assert.equal(DEFAULT_GUESS_ROWS.length, 2 + 3 + 2 + 2 + 17 + 14);
  assert.deepEqual(DEFAULT_GUESS_ROWS[0], { rank: 'Y', num: 1 });
  assert.deepEqual(DEFAULT_GUESS_ROWS.at(-1), { rank: 'J', num: 14 });
});
