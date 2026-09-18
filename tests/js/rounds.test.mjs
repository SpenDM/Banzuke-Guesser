import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { bashoName, nextBashoId, reopenDate, rounds } from '../../public/js/rounds.js';

test('nextBashoId steps two months and wraps the year', () => {
  assert.equal(nextBashoId('202607'), '202609');
  assert.equal(nextBashoId('202611'), '202701');
  assert.equal(nextBashoId('202701'), '202703');
});

test('rounds are named after the predicted tournament, newest first', () => {
  assert.deepEqual(rounds(['202607', '202611', '202609']), [
    { fileId: '202611', roundId: '202701', year: '2027', name: 'January 2027' },
    { fileId: '202609', roundId: '202611', year: '2026', name: 'November 2026' },
    { fileId: '202607', roundId: '202609', year: '2026', name: 'September 2026' },
  ]);
  assert.equal(bashoName('202803'), 'March 2028');
});

test('reopenDate is the day after the tournament ends', () => {
  assert.equal(reopenDate('2026-09-27'), 'Sep 28');
  assert.equal(reopenDate('2026-11-30'), 'Dec 1');
  assert.equal(reopenDate(null), null);
});
