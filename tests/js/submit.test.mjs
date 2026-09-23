import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { GuessState } from '../../public/js/state.js';
import { validateGuess } from '../../public/js/submit.js';

// A six-man Makuuchi (plus one Juryo) keeps the examples short; `spots` follows the headcount.
const basho = {
  id: '202607',
  rikishi: [
    ['a', 'Y', 1, 'E', 10], ['b', 'O', 1, 'E', 11], ['c', 'S', 1, 'E', 12], ['d', 'K', 1, 'E', 13],
    ['e', 'M', 1, 'E', 14], ['f', 'M', 1, 'W', null], ['j', 'J', 1, 'E', 16],
  ].map(([key, rank, num, side, rikishi_id]) => ({
    key, name: key.toUpperCase(), rank, num, side, rikishi_id, division: rank === 'J' ? 'juryo' : 'makuuchi',
  })),
};

const filled = () => {
  const s = new GuessState(basho);
  for (const [key, slot] of [['a', 'Y1E'], ['b', 'O1E'], ['c', 'S1E'], ['d', 'K1E'], ['e', 'M1E'], ['f', 'M1W']]) s.place(key, slot);
  return s;
};

test('a complete, conflict-free Makuuchi passes', () => {
  assert.equal(validateGuess(filled()), null);
});

test('headcount comes first: too few or too many, counting ↑ candidates but not Juryo', () => {
  const s = filled();
  s.remove('f');
  assert.equal(validateGuess(s), 'Not enough rikishi!');
  s.place('f', 'vJ');                         // demotion candidates: Juryo-bound, still missing
  assert.equal(validateGuess(s), 'Not enough rikishi!');
  s.place('f', '^M');                         // promotion candidates count toward Makuuchi
  assert.equal(validateGuess(s), 'Unplaced at ↑M');
  s.place('f', 'M1W');
  s.place('j', 'M2E');
  assert.equal(validateGuess(s), 'Too many rikishi!');
});

test('shared slots are reported top-down before gaps', () => {
  const s = filled();
  s.place('f', 'M1E');                        // e and f both at M1E, M1W empty: still six in Makuuchi
  assert.equal(validateGuess(s), 'Multiple at M1E');
  s.place('f', 'M1W');
  s.place('e', 'S1E');                        // c and e share S1E; the M1E hole is reported later
  s.place('j', 'M2E');
  assert.equal(validateGuess(s), 'Too many rikishi!');
  s.remove('j');
  s.place('f', 'M1E');
  assert.equal(validateGuess(s), 'Multiple at S1E');
});

test('a gap is an empty slot above a filled one of the same rank type', () => {
  const s = filled();
  s.place('f', 'M2W');
  assert.equal(validateGuess(s), 'Gap at M1W');
  s.place('f', 'M1W');
  s.place('d', 'S1W');                        // K1E empty is fine: nothing below it in Komusubi
  assert.equal(validateGuess(s), null);
  s.addRow('S');
  s.place('d', 'S2E');
  assert.equal(validateGuess(s), 'Gap at S1W');
});

test('a sanyaku rank may leave the East side of its last filled row empty', () => {
  const s = filled();
  s.place('d', 'S1W');
  s.addRow('S');
  s.place('e', 'S2W');                        // Nagoya 2025: S2W filled, S2E empty
  s.place('f', 'M1E');
  assert.equal(validateGuess(s), null);
  s.addRow('S');
  s.place('e', 'S3W');                        // ...but not once a lower row is filled
  assert.equal(validateGuess(s), 'Gap at S2E');
  s.place('e', 'S2W');
  s.place('a', 'Y1W');                        // same for Yokozuna/Ozeki
  assert.equal(validateGuess(s), null);
});

test('makuuchiPlacements lists numbered Makuuchi slots in banzuke order with ids', () => {
  const s = filled();
  s.place('j', 'vJ');
  const p = s.makuuchiPlacements();
  assert.deepEqual(p.map((x) => x.slot), ['Y1E', 'O1E', 'S1E', 'K1E', 'M1E', 'M1W']);
  assert.deepEqual(p[0], { slot: 'Y1E', key: 'a', rikishi_id: 10, name: 'A' });
  assert.equal(p[5].rikishi_id, null);
});
