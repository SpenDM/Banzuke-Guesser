import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { GuessState } from '../../public/js/state.js';

// Minimal EventTarget/Event shims exist in Node 16+, so GuessState loads as-is.
const basho = {
  id: '202607',
  rikishi: [
    { key: 'onosato', name: 'Onosato', rank: 'Y', num: 1, side: 'W', division: 'makuuchi' },
    { key: 'aonishiki', name: 'Aonishiki', rank: 'S', num: 2, side: 'W', division: 'makuuchi' },
    { key: 'tomokaze', name: 'Tomokaze', rank: 'J', num: 3, side: 'E', division: 'juryo', rikishi_id: 7 },
    { key: 'nishinoryu', name: 'Nishinoryu', rank: 'Ms', num: 1, side: 'E', division: 'makushita' },
  ],
};

test('sanyaku ranks start with as many rows as the previous banzuke had', () => {
  const s = new GuessState(basho);
  assert.deepEqual([s.rowCounts.Y, s.rowCounts.O, s.rowCounts.S, s.rowCounts.K], [1, 1, 2, 1]);
  assert.deepEqual([s.rowCounts.M, s.rowCounts.J, s.rowCounts.Ms], [18, 14, 15]);
});

test('Save Juryo starts off, also when loading a snapshot from before it existed', () => {
  assert.equal(new GuessState(basho).saveJuryo, false);
  const s = new GuessState(basho);
  s.load({ basho: '202607', guesses: { onosato: 'Y1E' } });
  assert.equal(s.saveJuryo, false);
});

test('Juryo placements are kept apart from Makuuchi and only submitted when Save Juryo is on', () => {
  const s = new GuessState(basho);
  s.place('onosato', 'Y1E');
  s.place('tomokaze', 'J1W');
  s.place('nishinoryu', 'J14E');
  assert.deepEqual(s.makuuchiPlacements().map((p) => p.key), ['onosato']);
  assert.deepEqual(s.juryoPlacements(), [
    { slot: 'J1W', key: 'tomokaze', rikishi_id: 7, name: 'Tomokaze' },
    { slot: 'J14E', key: 'nishinoryu', rikishi_id: null, name: 'Nishinoryu' },
  ]);
  assert.equal(s.submission().juryo, null);
  let changes = 0;
  s.addEventListener('change', () => changes++);
  s.setSaveJuryo(true);
  s.setSaveJuryo(true); // no change, no event
  assert.equal(changes, 1);
  assert.deepEqual(s.submission().juryo.map((p) => p.slot), ['J1W', 'J14E']);

  const b = new GuessState(basho);
  b.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(b.saveJuryo, true);
  b.restore([{ slot: 'Y1W', key: 'onosato' }]);
  assert.equal(b.saveJuryo, false);
  assert.equal(b.slotOf('tomokaze'), null);
  b.restore([{ slot: 'Y1W', key: 'onosato' }, { slot: 'J2E', key: 'tomokaze' }], { saveJuryo: true });
  assert.equal(b.saveJuryo, true);
  assert.equal(b.slotOf('tomokaze'), 'J2E');
});

test('the Juryo candidates row appears below Juryo once someone is in ↑J or ↓Ms', () => {
  const s = new GuessState(basho);
  const candidateRows = () => s.rows().filter((r) => r.candidates);
  assert.deepEqual(candidateRows(), []);
  s.place('tomokaze', 'vMs');
  const rows = s.rows();
  const i = rows.findIndex((r) => r.candidates);
  assert.deepEqual([rows[i - 1], rows[i], rows[i + 1]], [{ rank: 'J', num: 14 }, { rank: 'J', candidates: true }, { rank: 'Ms', num: 1 }]);
  s.place('tomokaze', '^J');
  assert.deepEqual(candidateRows(), [{ rank: 'J', candidates: true }]);
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

test('counts() tracks Makuuchi and Juryo slots holding exactly one rikishi', () => {
  const s = new GuessState(basho);
  assert.deepEqual(s.counts(), { spots: 2, filled: 0, juryoSpots: 1, juryoFilled: 0 });
  s.place('onosato', 'Y1E');
  assert.equal(s.counts().filled, 1);
  s.place('aonishiki', 'Y1E'); // doubled up: no longer counts
  assert.equal(s.counts().filled, 0);
  s.place('aonishiki', 'J1E');  // Juryo is counted apart
  assert.equal(s.counts().filled, 1);
  assert.equal(s.counts().juryoFilled, 1);
  s.place('aonishiki', '^K');   // nor do candidates rows
  assert.equal(s.counts().filled, 1);
});

test('restore replaces every guess with the saved placements, adding the rows they use', () => {
  const s = new GuessState(basho);
  s.place('aonishiki', 'M3E');
  s.restore([{ slot: 'Y2E', key: 'onosato' }, { slot: 'X9Q', key: 'aonishiki' }, { slot: 'O1E', key: 'gone' }]);
  assert.deepEqual(Object.fromEntries(s.guesses), { onosato: 'Y2E' });
  assert.equal(s.rowCounts.Y, 2);
});
