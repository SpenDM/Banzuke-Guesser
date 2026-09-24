import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { linearize, rankSubmissions, scoreGtb, scoreGuess } from '../../public/js/score.js';

// Four rikishi A-D on a tiny banzuke; `order` lists them top to bottom.
const SLOTS = ['M1E', 'M1W', 'M2E', 'M2W'];
const lineup = (order, ids = true) => [...order].map((ch, i) => ({
  slot: SLOTS[i], key: ch.toLowerCase(), name: ch, rikishi_id: ids ? ch.charCodeAt(0) : null,
}));
const points = (order) => {
  const s = scoreGuess(lineup(order), lineup('ABCD'));
  return [s.placements, s.neighbors, s.total];
};

test('the worked examples: ABCD 7, DABC 2, ABDC 3, DACB 1', () => {
  assert.deepEqual(points('ABCD'), [4, 3, 7]);
  assert.deepEqual(points('DABC'), [0, 2, 2]);
  assert.deepEqual(points('ABDC'), [2, 1, 3]);
  assert.deepEqual(points('DACB'), [1, 0, 1]);
});

test('correctSlots names where the prediction is right', () => {
  assert.deepEqual([...scoreGuess(lineup('ABDC'), lineup('ABCD')).correctSlots], ['M1E', 'M1W']);
});

test('order is by slot, not by list order', () => {
  const shuffled = [...lineup('ABCD')].reverse();
  assert.deepEqual(linearize(shuffled).map((p) => p.name), ['A', 'B', 'C', 'D']);
  assert.equal(scoreGuess(shuffled, lineup('ABCD')).total, 7);
});

test('rikishi are matched by id first, so a renamed rikishi still scores; by key when ids are missing', () => {
  const actual = lineup('ABCD');
  const renamed = lineup('ABCD').map((p) => (p.name === 'C' ? { ...p, key: 'c-new', name: 'C-new' } : p));
  assert.equal(scoreGuess(renamed, actual).total, 7);
  assert.equal(scoreGuess(lineup('ABCD', false), actual).total, 7);
  // Unknown rikishi (not on the real banzuke) score nothing and break the neighbour chain.
  const stranger = lineup('ABCD').map((p) => (p.name === 'B' ? { ...p, key: 'x', name: 'X', rikishi_id: 999 } : p));
  const s = scoreGuess(stranger, actual);
  assert.deepEqual([s.placements, s.neighbors], [3, 1]);
});

test('a prediction with different sanyaku row counts is scored slot by slot', () => {
  const actual = [
    { slot: 'S1E', key: 'a', name: 'A', rikishi_id: 1 }, { slot: 'S1W', key: 'b', name: 'B', rikishi_id: 2 },
    { slot: 'K1E', key: 'c', name: 'C', rikishi_id: 3 },
  ];
  const guess = [
    { slot: 'S1E', key: 'a', name: 'A', rikishi_id: 1 }, { slot: 'S1W', key: 'b', name: 'B', rikishi_id: 2 },
    { slot: 'S2E', key: 'c', name: 'C', rikishi_id: 3 },
  ];
  const s = scoreGuess(guess, actual);
  assert.deepEqual([s.placements, s.neighbors, s.total], [2, 2, 4]);
});

test('rankSubmissions shares positions between ties and labels them T-n', () => {
  const ranked = rankSubmissions([
    { shikona: 'b', placements: 3, neighbors: 1, total: 4 },
    { shikona: 'a', placements: 3, neighbors: 1, total: 4 },
    { shikona: 'c', placements: 4, neighbors: 0, total: 4 },
    { shikona: 'd', placements: 0, neighbors: 1, total: 1 },
  ]);
  assert.deepEqual(ranked.map((r) => [r.shikona, r.label]), [['c', '1'], ['a', 'T-2'], ['b', 'T-2'], ['d', '4']]);
});

test('GTB: 2 points for rank and side, 1 for the rank on the other side, 0 otherwise', () => {
  // Real ABCD in M1E M1W M2E M2W. BADC: all four on the right rank, wrong side.
  assert.deepEqual(scoreGtb(lineup('BADC'), lineup('ABCD')), { gtb: 4, gtbHits: 4 });
  assert.deepEqual(scoreGtb(lineup('ABCD'), lineup('ABCD')), { gtb: 8, gtbHits: 4 });
  // CDAB: everyone a rank off.
  assert.deepEqual(scoreGtb(lineup('CDAB'), lineup('ABCD')), { gtb: 0, gtbHits: 0 });
  // ABDC: A, B bulls-eyes, C and D swapped sides within M2.
  const s = scoreGuess(lineup('ABDC'), lineup('ABCD'));
  assert.deepEqual([s.gtb, s.gtbHits], [6, 4]);
});

test('GTB: sanyaku ranks are numbered, and candidate rows score nothing', () => {
  const actual = [{ slot: 'S1E', key: 'a', rikishi_id: 1 }, { slot: 'S2E', key: 'b', rikishi_id: 2 }];
  const guess = [{ slot: 'S2W', key: 'a', rikishi_id: 1 }, { slot: '^S', key: 'b', rikishi_id: 2 }];
  assert.deepEqual(scoreGtb(guess, actual), { gtb: 0, gtbHits: 0 });
});

test('rankSubmissions by GTB orders by GTB score, then hits', () => {
  const ranked = rankSubmissions([
    { shikona: 'a', placements: 9, total: 20, gtb: 10, gtbHits: 6 },
    { shikona: 'b', placements: 1, total: 5, gtb: 12, gtbHits: 7 },
    { shikona: 'c', placements: 1, total: 5, gtb: 10, gtbHits: 8 },
  ], 'gtb');
  assert.deepEqual(ranked.map((r) => [r.shikona, r.label]), [['b', '1'], ['c', '2'], ['a', '3']]);
});
