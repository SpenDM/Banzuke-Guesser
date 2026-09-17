import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { GuessState } from '../../public/js/state.js';

// Minimal EventTarget/Event shims exist in Node 16+, so GuessState loads as-is.
const basho = {
  id: '202607',
  rikishi: [
    { key: 'onosato', name: 'Onosato', rank: 'Y', num: 1, side: 'W', division: 'makuuchi' },
    { key: 'aonishiki', name: 'Aonishiki', rank: 'S', num: 2, side: 'W', division: 'makuuchi' },
  ],
};

test('sanyaku ranks start with as many rows as the previous banzuke had', () => {
  const s = new GuessState(basho);
  assert.deepEqual([s.rowCounts.Y, s.rowCounts.O, s.rowCounts.S, s.rowCounts.K], [1, 1, 2, 1]);
  assert.deepEqual([s.rowCounts.M, s.rowCounts.J], [18, 14]);
});

test('toJSON/load round-trips guesses and extra rows', () => {
  const a = new GuessState(basho);
  a.place('onosato', 'Y1E');
  a.addRow('Y');
  const b = new GuessState(basho);
  assert.equal(b.load(JSON.parse(JSON.stringify(a.toJSON()))), true);
  assert.equal(b.slotOf('onosato'), 'Y1E');
  assert.equal(b.rowCounts.Y, 2);
});

test('addRow/removeRow respect the min/max bounds and clear guesses in a removed row', () => {
  const s = new GuessState(basho);
  assert.equal(s.rowCounts.Y, 1);
  s.addRow('Y');
  s.addRow('Y');
  s.addRow('Y'); // already at the max (3); this should no-op
  assert.equal(s.rowCounts.Y, 3);

  s.place('onosato', 'Y3W');
  s.removeRow('Y'); // drops Y3, which onosato was guessed into
  assert.equal(s.rowCounts.Y, 2);
  assert.equal(s.slotOf('onosato'), null);

  s.removeRow('Y');
  s.removeRow('Y'); // already at the min (1); this should no-op
  assert.equal(s.rowCounts.Y, 1);
});

test('load ignores snapshots from another basho and unknown rikishi/slots', () => {
  const s = new GuessState(basho);
  assert.equal(s.load({ basho: '202609', guesses: { onosato: 'Y1E' } }), false);
  assert.equal(s.slotOf('onosato'), null);
  s.load({ basho: '202607', guesses: { ghost: 'M1E', aonishiki: 'nonsense', onosato: 'O1E' }, rowCounts: { Z: 9, M: 'x' } });
  assert.equal(s.slotOf('ghost'), null);
  assert.equal(s.slotOf('aonishiki'), null);
  assert.equal(s.slotOf('onosato'), 'O1E');
  assert.equal(s.rowCounts.M, 18);
});

test('counts() tracks Makuuchi slots holding exactly one rikishi', () => {
  const s = new GuessState(basho);
  assert.deepEqual(s.counts(), { spots: 2, filled: 0 });
  s.place('onosato', 'Y1E');
  assert.equal(s.counts().filled, 1);
  s.place('aonishiki', 'Y1E'); // doubled up: no longer counts
  assert.equal(s.counts().filled, 0);
  s.place('aonishiki', 'J1E');  // Juryo doesn't count
  assert.equal(s.counts().filled, 1);
  s.place('aonishiki', '^K');   // nor do candidates rows
  assert.equal(s.counts().filled, 1);
});
