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

test('toJSON/load round-trips guesses and extra rows', () => {
  const a = new GuessState(basho);
  a.place('onosato', 'Y1E');
  a.addRow('Y');
  const b = new GuessState(basho);
  assert.equal(b.load(JSON.parse(JSON.stringify(a.toJSON()))), true);
  assert.equal(b.slotOf('onosato'), 'Y1E');
  assert.equal(b.rowCounts.Y, 3);
});

test('addRow/removeRow respect the min/max bounds and clear guesses in a removed row', () => {
  const s = new GuessState(basho);
  assert.equal(s.rowCounts.Y, 2);
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
  assert.equal(s.rowCounts.M, 17);
});
