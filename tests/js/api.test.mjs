import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { JURYO_MAX, MAKUSHITA_MAX, validatePlacements } from '../../functions/api/submit.js';

const place = (slot, i) => ({ slot, key: `r${i}`, rikishi_id: i, name: `R${i}` });

test('a Juryo list may be partial but only holds Juryo slots, each once, and no one placed in Makuuchi', () => {
  const juryo = { division: 'juryo' };
  assert.deepEqual(validatePlacements([], juryo), []);
  assert.deepEqual(validatePlacements([place('J1E', 1), place('J14W', 2)], juryo).map((p) => p.slot), ['J1E', 'J14W']);
  assert.match(validatePlacements([place('M1E', 1)], juryo), /bad slot/);
  assert.match(validatePlacements([place('Ms1E', 1)], juryo), /bad slot/);
  assert.match(validatePlacements([place('J1E', 1), place('J1E', 2)], juryo), /used twice/);
  assert.match(validatePlacements([place('J1E', 1)], { ...juryo, taken: new Set([1]) }), /placed twice/);
  assert.match(validatePlacements(Array.from({ length: JURYO_MAX + 1 }, (_, i) => place(`J${i}E`, i)), juryo), /at most/);
  assert.match(validatePlacements('x', juryo), /juryo must be a list/);
});

test('Makuuchi placements still need exactly 42 and reject Juryo slots', () => {
  const mak = Array.from({ length: 42 }, (_, i) => place(`M${Math.floor(i / 2) + 1}${i % 2 ? 'W' : 'E'}`, i));
  assert.equal(validatePlacements(mak).length, 42);
  assert.match(validatePlacements(mak.slice(1)), /exactly 42/);
  assert.match(validatePlacements([...mak.slice(1), place('J1E', 99)]), /bad slot/);
});

test('a Makushita list only holds its top 15 rows, and no one placed above', () => {
  const makushita = { division: 'makushita' };
  assert.deepEqual(validatePlacements([place('Ms1E', 1), place('Ms15W', 2)], makushita).map((p) => p.slot), ['Ms1E', 'Ms15W']);
  assert.match(validatePlacements([place('Ms16E', 1)], makushita), /bad slot/);
  assert.match(validatePlacements([place('J1E', 1)], makushita), /bad slot/);
  assert.match(validatePlacements([place('Ms1E', 1)], { ...makushita, taken: new Set([1]) }), /placed twice/);
  assert.match(validatePlacements(Array.from({ length: MAKUSHITA_MAX + 1 }, (_, i) => place(`Ms${(i % 15) + 1}E`, i)), makushita), /at most/);
});
