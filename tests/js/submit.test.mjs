import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { GuessState } from '../../public/js/state.js';
import { SubmitController, guessIssues, validateGuess } from '../../public/js/submit.js';

// An eight-man Makuuchi (plus one Juryo) keeps the examples short; `spots` follows the headcount.
const basho = {
  id: '202607',
  rikishi: [
    ['a', 'Y', 1, 'E', 10], ['b', 'O', 1, 'E', 11], ['c', 'S', 1, 'E', 12], ['g', 'S', 1, 'W', 17],
    ['d', 'K', 1, 'E', 13], ['h', 'K', 1, 'W', 18], ['e', 'M', 1, 'E', 14], ['f', 'M', 1, 'W', null],
    ['j', 'J', 1, 'E', 16], ['k', 'J', 1, 'W', 19], ['m', 'Ms', 1, 'E', 20],
  ].map(([key, rank, num, side, rikishi_id]) => ({
    key, name: key.toUpperCase(), rank, num, side, rikishi_id, division: { J: 'juryo', Ms: 'makushita' }[rank] ?? 'makuuchi',
  })),
};

const filled = () => {
  const s = new GuessState(basho);
  const placed = [['a', 'Y1E'], ['b', 'O1E'], ['c', 'S1E'], ['g', 'S1W'], ['d', 'K1E'], ['h', 'K1W'], ['e', 'M1E'], ['f', 'M1W']];
  for (const [key, slot] of placed) s.place(key, slot);
  return s;
};

test('a complete, conflict-free Makuuchi passes', () => {
  assert.equal(validateGuess(filled()), null);
});

test('headcount comes first: too few or too many, counting ↑S/↑K candidates but not ↑M or Juryo', () => {
  const s = filled();
  s.remove('f');
  assert.equal(validateGuess(s), 'Not enough rikishi!');
  s.place('f', 'vJ');                         // demotion candidates: Juryo-bound, still missing
  assert.equal(validateGuess(s), 'Not enough rikishi!');
  s.place('f', '^M');                         // the Maegashira candidates row is outside Makuuchi
  assert.equal(validateGuess(s), 'Not enough rikishi!');
  s.place('f', '^K');                         // Komusubi candidates count toward Makuuchi
  assert.equal(validateGuess(s), 'Unplaced at ↑K');
  s.place('f', 'M1W');
  s.place('j', 'M2E');
  assert.equal(validateGuess(s), 'Too many rikishi!');
});

test('shared slots are reported top-down before gaps', () => {
  const s = filled();
  s.place('f', 'M1E');                        // e and f both at M1E, M1W empty: still eight in Makuuchi
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
  s.addRow('S');
  s.place('g', 'S2E');
  assert.equal(validateGuess(s), 'Gap at S1W');
});

test('a sanyaku rank may leave the East side of its last filled row empty', () => {
  const s = filled();
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
  assert.deepEqual(p.map((x) => x.slot), ['Y1E', 'O1E', 'S1E', 'S1W', 'K1E', 'K1W', 'M1E', 'M1W']);
  assert.deepEqual(p[0], { slot: 'Y1E', key: 'a', rikishi_id: 10, name: 'A' });
  assert.equal(p[7].rikishi_id, null);
});

const issues = (s) => [...guessIssues(s)].sort();

test('guessIssues: none for a complete, conflict-free Makuuchi', () => {
  assert.deepEqual(issues(filled()), []);
});

test('guessIssues marks shared slots, filled ↑ rows and gaps', () => {
  const s = filled();
  s.place('f', 'M1E');                        // shares M1E with e
  assert.deepEqual(issues(s), ['M1E']);       // still eight rikishi, so no missing slot at the end
  s.place('f', '^K');                         // unplaced candidate, headcount still 8
  assert.deepEqual(issues(s), ['^K']);
  s.place('f', 'M2E');                        // M1W left empty above M2E
  assert.deepEqual(issues(s), ['M1W']);
});

test('guessIssues marks the end of the Maegashira when the headcount is off', () => {
  const s = filled();
  s.remove('f');
  s.remove('e');                              // two short: the next two slots
  assert.deepEqual(issues(s), ['M1E', 'M1W']);
  s.place('e', 'M1E');
  s.place('f', 'M2E');                        // back to eight, but M1W is a gap
  assert.deepEqual(issues(s), ['M1W']);
  s.place('j', 'M2W');                        // one too many: the last filled slot
  assert.deepEqual(issues(s), ['M1W', 'M2W']);
});

test('guessIssues counts a gap as a missing rikishi, not also marking the end', () => {
  const s = filled();
  s.remove('f');
  s.place('e', 'M1W');                        // one short, with M1E a gap: only the gap
  assert.deepEqual(issues(s), ['M1E']);
  s.remove('b');                              // two short (an empty rank is no gap): the gap and one end slot
  assert.deepEqual(issues(s), ['M1E', 'M2E']);
});

test('guessIssues counts every rikishi in a shared slot toward the headcount', () => {
  const s = filled();
  s.place('j', 'M1W');                        // M1W holds f and j: 9 rikishi for 8 spots
  assert.deepEqual(issues(s), ['M1W']);
});

test('rikishi may be left in the Maegashira candidates row of a full banzuke', () => {
  const s = filled();
  s.place('j', '^M');                         // Juryo rikishi considered for promotion, left out
  assert.equal(validateGuess(s), null);
  assert.deepEqual(issues(s), []);
});

test('a banzuke needs at least two Sekiwake and two Komusubi, checked after gaps', () => {
  const s = filled();
  s.place('g', 'M2E');                        // one Sekiwake left: the first empty Sekiwake slot
  assert.equal(validateGuess(s), 'Need 2 Sekiwake');
  assert.deepEqual(issues(s), ['S1W']);
  s.place('g', 'S1W');
  s.place('d', 'M2E');
  s.place('h', 'M2W');                        // no Komusubi: both slots
  assert.equal(validateGuess(s), 'Need 2 Komusubi');
  assert.deepEqual(issues(s), ['K1E', 'K1W']);
  s.addRow('K');
  s.place('d', 'K1E');
  s.place('h', 'K2E');                        // the gap is reported first
  assert.equal(validateGuess(s), 'Gap at K1W');
  s.place('e', 'K1W');
  s.place('f', 'M1E');                        // three Komusubi is fine
  assert.equal(validateGuess(s), null);
  assert.deepEqual(issues(s), []);
});

test('guessIssues counts a sanyaku shortfall slot as a missing rikishi', () => {
  const s = filled();
  s.remove('g');                              // one short, and it is the missing Sekiwake
  assert.deepEqual(issues(s), ['S1W']);
  s.place('g', 'S1E');                        // shared S1E counts as one Sekiwake
  assert.equal(validateGuess(s), 'Multiple at S1E');
  assert.deepEqual(issues(s), ['S1E', 'S1W']);
});

// A stand-in for the button and note elements, and the RegisterController's event source.
const fakeEl = () => Object.assign(new EventTarget(), { textContent: '', disabled: false, hidden: false, classList: { toggle() {} } });
const controller = (round, now = '2026-09-24') => {
  const register = Object.assign(new EventTarget(), { shikona: 'Tester' });
  const els = { button: fakeEl(), note: fakeEl() };
  return { c: new SubmitController(filled(), round, els, register, { now: () => now }), els, register };
};
const profileEvent = (roundId, submission) => new CustomEvent('change', {
  detail: { profile: { shikona: 'Tester' }, submission, roundId },
});

test('Save Guess is closed from the announcement day and open for the round after it', () => {
  const current = controller({ id: '202609', banzuke_date: '2026-08-31', reopens: 'Sep 27' });
  assert.equal(current.els.button.disabled, true);
  assert.equal(current.els.button.textContent, 'Submissions closed\nuntil Sep 27');
  const next = controller({ id: '202611', banzuke_date: '2026-10-26', reopens: 'Nov 22' });
  assert.equal(next.els.button.disabled, false);
  assert.equal(next.els.button.textContent, 'Save\nGuess');
});

test('the Juryo/Makushita candidates row is outside Makuuchi: not counted, not flagged', () => {
  const s = filled();
  s.place('f', '^J');                         // a Makuuchi one short, with someone in ↑J
  assert.equal(validateGuess(s), 'Not enough rikishi!');
  assert.deepEqual([...guessIssues(s)], ['M1W']); // the empty end slot, not ↑J
  s.place('f', 'vMs');
  assert.deepEqual([...guessIssues(s)], ['M1W']);
  s.place('f', 'M1W');
  s.place('j', '^J');
  assert.equal(validateGuess(s), null);
  assert.equal(guessIssues(s).size, 0);
});

test('Save Juryo: Juryo is only checked when saved, for headcount, shared slots, the ↑M/↓J row and gaps', () => {
  // A two-rikishi Juryo (j, k) keeps this short: the headcount is the previous banzuke's Juryo size.
  const s = filled();
  s.place('j', 'J2E');
  s.place('k', 'J2E');
  s.place('e', 'M1E');
  assert.equal(validateGuess(s), null);           // not saved: Juryo is ignored
  assert.equal(guessIssues(s).size, 0);
  s.setSaveJuryo(true);
  assert.equal(validateGuess(s), 'Multiple at J2E');
  assert.deepEqual([...guessIssues(s)].sort(), ['J1E', 'J1W', 'J2E']); // J1 above it is a gap too
  s.place('k', 'J2W');                            // J1E and J1W are now gaps
  assert.equal(validateGuess(s), 'Gap at J1E');
  assert.deepEqual([...guessIssues(s)].sort(), ['J1E', 'J1W']);
  s.place('j', 'J1E');
  s.place('k', 'J1W');
  assert.equal(validateGuess(s), null);
  s.place('k', 'vJ');                             // left in the Maegashira/Juryo row: short one
  assert.equal(validateGuess(s), 'Not enough Juryo!');
  assert.deepEqual([...guessIssues(s)].sort(), ['J1W', 'vJ']);
  s.place('k', '^M');
  assert.equal(validateGuess(s), 'Not enough Juryo!');
  s.place('k', 'J2E');
  assert.equal(validateGuess(s), 'Gap at J1W');
  s.place('k', 'J1W');
  assert.equal(validateGuess(s), null);
  s.setSaveJuryo(false);
  s.place('k', 'vJ');
  assert.equal(validateGuess(s), null);           // unticked again: no Juryo checks
});

test('Save Guess sends the Juryo guesses only when Save Juryo is on, and a change to it re-opens saving', async () => {
  const bodies = [];
  const fetchImpl = async (url, { body }) => { bodies.push(body); return { ok: true, json: async () => ({ shikona: 'Tester', submitted_at: 't' }) }; };
  const register = Object.assign(new EventTarget(), { shikona: 'Tester' });
  const els = { button: fakeEl(), note: fakeEl() };
  const state = filled();
  state.place('j', 'J1E');
  const c = new SubmitController(state, { id: '202611', banzuke_date: '2026-10-26', reopens: 'Nov 22' }, els, register, { fetchImpl, now: () => '2026-09-24' });
  await c.send();
  assert.equal('juryo' in bodies[0], false);
  assert.equal(els.button.textContent, 'Saved');
  state.setSaveJuryo(true);
  assert.equal(els.button.textContent, 'Save\nGuess');
  await c.send();
  assert.deepEqual(bodies[1].juryo, [{ slot: 'J1E', key: 'j', rikishi_id: 16, name: 'J' }]);
  assert.equal(els.button.textContent, 'Saved');
  state.place('j', 'J2W');                         // a Juryo change is a change to the prediction
  assert.equal(els.button.textContent, 'Save\nGuess');
});

test('a profile answer for another round leaves the submission alone', () => {
  const { c, els, register } = controller({ id: '202611', banzuke_date: '2026-10-26', reopens: 'Nov 22' });
  const submission = { placements: c.state.makuuchiPlacements(), submitted_at: 'x' };
  register.dispatchEvent(profileEvent('202609', submission));
  assert.equal(els.button.textContent, 'Save\nGuess');
  register.dispatchEvent(profileEvent('202611', submission));
  assert.equal(els.button.textContent, 'Saved');
});

test('Makushita, when saved, is checked after Juryo: 30 rikishi in its top 15 rows, the ↑J/↓Ms row empty, no gaps', () => {
  const s = filled();
  s.place('j', 'J1E');
  s.place('k', 'J1W');
  s.place('m', 'Ms1E');
  s.setSaveMakushita(true);                       // ticks Juryo too
  assert.equal(s.saveJuryo, true);
  assert.equal(validateGuess(s), 'Not enough Makushita!');
  assert.equal(guessIssues(s).has('Ms15W'), true); // the end of the 30 Makushita slots
  s.place('m', '^J');
  assert.equal(guessIssues(s).has('^J'), true);
  s.place('k', 'Ms1E');                           // Juryo is checked first
  assert.equal(validateGuess(s), 'Not enough Juryo!');
  s.setSaveJuryo(false);                          // unticks Makushita too: nothing below Makuuchi is checked
  assert.equal(s.saveMakushita, false);
  assert.equal(validateGuess(s), null);
});

test('Save Guess sends the top of Makushita only when it is included', async () => {
  const bodies = [];
  const fetchImpl = async (url, { body }) => { bodies.push(body); return { ok: true, json: async () => ({ shikona: 'Tester', submitted_at: 't' }) }; };
  const register = Object.assign(new EventTarget(), { shikona: 'Tester' });
  const els = { button: fakeEl(), note: fakeEl() };
  const state = filled();
  state.place('m', 'Ms2W');
  const c = new SubmitController(state, { id: '202611', banzuke_date: '2026-10-26', reopens: 'Nov 22' }, els, register, { fetchImpl, now: () => '2026-09-24' });
  state.setSaveJuryo(true);
  await c.send();
  assert.equal('makushita' in bodies[0], false);
  state.setSaveMakushita(true);
  assert.equal(els.button.textContent, 'Save\nGuess');
  await c.send();
  assert.deepEqual(bodies[1].makushita, [{ slot: 'Ms2W', key: 'm', rikishi_id: 20, name: 'M' }]);
  assert.equal(els.button.textContent, 'Saved');
});
