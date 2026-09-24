// "Save Guess": checks the prediction is a complete Makuuchi banzuke and saves it through the
// API (functions/api/submit.js) under the shikona the user registered (register.js). Owns the
// button's text/enabled state.
import { DIVISION_OF, RANK_ORDER, compareSlots, parseSlot, slotId, slotName } from './rank.js';
import { formatDate, todayJST } from './dates.js';
import { loadSubmission, saveSubmission } from './storage.js';
import { api } from './auth.js';

const MAKUUCHI_RANKS = RANK_ORDER.filter((rank) => DIVISION_OF[rank] === 'makuuchi');

/** How many rikishi each slot holds, from the guess state. */
function occupancy(state) {
  const perSlot = new Map();
  for (const slot of state.guesses.values()) perSlot.set(slot, (perSlot.get(slot) || 0) + 1);
  return perSlot;
}

/**
 * The rikishi counted toward the Makuuchi headcount: `numbered` lists the numbered Makuuchi slots
 * in use, `unplaced` the ↑ candidates rows holding rikishi (both in banzuke order), `total` how
 * many rikishi those hold.
 */
function headcount(perSlot) {
  const numbered = [];
  const unplaced = [];
  let total = 0;
  for (const [slot, n] of perSlot) {
    const s = parseSlot(slot);
    if (s.candidates === 'up') { unplaced.push(slot); total += n; }
    else if (!s.candidates && DIVISION_OF[s.rank] === 'makuuchi') { numbered.push(slot); total += n; }
  }
  const order = (a, b) => compareSlots(parseSlot(a), parseSlot(b));
  return { numbered: numbered.sort(order), unplaced: unplaced.sort(order), total };
}

/** A rank type's numbered slots, top-down: rank num E, rank num W, … */
function slotsOf(state, rank) {
  const out = [];
  for (let num = 1; num <= state.rowCounts[rank]; num++) out.push(slotId(rank, num, 'E'), slotId(rank, num, 'W'));
  return out;
}

/**
 * The gaps, top-down: empty slots above a filled one of the same rank type. A sanyaku rank's
 * lowest filled row may have either side empty (e.g. Nagoya 2025: S2W with no S2E), so for those
 * only the rows above it must be full.
 */
function gapSlots(state, perSlot) {
  const gaps = [];
  for (const rank of MAKUUCHI_RANKS) {
    const slots = slotsOf(state, rank);
    const lastFilled = slots.findLastIndex((slot) => perSlot.has(slot));
    const lastFilledRow = lastFilled >= 0 ? parseSlot(slots[lastFilled]).num : 0;
    for (const slot of slots.slice(0, Math.max(lastFilled, 0))) {
      if (perSlot.has(slot) || (rank !== 'M' && parseSlot(slot).num === lastFilledRow)) continue;
      gaps.push(slot);
    }
  }
  return gaps;
}

/**
 * Why the prediction cannot be submitted yet, or null when it can. Checked in order:
 * the Makuuchi headcount (rikishi in numbered Makuuchi slots or still in a ↑ candidates row),
 * slots holding more than one rikishi (and candidates left in a ↑ row), then gaps (gapSlots).
 */
export function validateGuess(state) {
  const { spots } = state.counts();
  const perSlot = occupancy(state);
  const { numbered, unplaced, total } = headcount(perSlot);
  if (total < spots) return 'Not enough rikishi!';
  if (total > spots) return 'Too many rikishi!';

  const multi = numbered.find((slot) => perSlot.get(slot) > 1);
  if (multi) return `Multiple at ${multi}`;
  if (unplaced.length) return `Unplaced at ${slotName(unplaced[0])}`;

  const [gap] = gapSlots(state, perSlot);
  return gap ? `Gap at ${gap}` : null;
}

/**
 * Every slot breaking the rules validateGuess checks, for Show Issues to outline: slots holding
 * more than one rikishi, ↑ candidates rows still holding rikishi, gaps, and the Maegashira slots
 * at the end where the headcount is off. The headcount counts every rikishi however they are
 * placed (a shared slot counts each of its rikishi), so the end is judged by how many rikishi the
 * banzuke has: short by n, with g gaps already marked (each a missing rikishi), the n - g empty
 * slots after the last filled Maegashira slot are marked; over by n, the last filled Maegashira
 * slots holding those n rikishi are.
 */
export function guessIssues(state) {
  const { spots } = state.counts();
  const perSlot = occupancy(state);
  const { numbered, unplaced, total } = headcount(perSlot);
  const gaps = gapSlots(state, perSlot);
  const issues = new Set([...numbered.filter((slot) => perSlot.get(slot) > 1), ...unplaced, ...gaps]);

  const maegashira = slotsOf(state, 'M');
  const lastFilled = maegashira.findLastIndex((slot) => perSlot.has(slot));
  const missing = spots - total - gaps.length;
  if (missing > 0) {
    for (const slot of maegashira.slice(lastFilled + 1, lastFilled + 1 + missing)) issues.add(slot);
  } else if (total > spots) {
    let excess = total - spots;
    for (let i = lastFilled; i >= 0 && excess > 0; i--) {
      const n = perSlot.get(maegashira[i]) || 0;
      if (!n) continue;
      issues.add(maegashira[i]);
      excess -= n;
    }
  }
  return issues;
}

const samePlacements = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const REGISTER_FIRST = 'Register first';

/**
 * The submit button and the "come back <date>" note.
 * `round` is the tournament being predicted ({id, name, banzuke_date, reopens}, `reopens` being
 * the formatted day the next round opens); `els` the elements {button, note}; `register` the
 * RegisterController (its shikona gates submitting, and its 'change' events carry the server's
 * copy of this round's submission).
 */
export class SubmitController {
  constructor(state, round, els, register, { fetchImpl = api, now = todayJST } = {}) {
    this.state = state;
    this.round = round;
    this.els = els;
    this.register = register;
    this.fetch = (...args) => fetchImpl(...args);
    this.now = now;
    this.submission = round ? loadSubmission(round.id) : null;
    this.message = null;      // a validation/API message shown on the button until the next change
    this.sending = false;
    this.listeners = new AbortController();
    const { signal } = this.listeners;
    state.addEventListener('change', () => this.onChange(), { signal });
    els.button.addEventListener('click', () => this.onClick(), { signal });
    register.addEventListener('change', (e) => this.onProfile(e.detail), { signal });
    this.render();
  }

  /** Stops listening (the page moved on to another basho). */
  dispose() { this.listeners.abort(); }

  get closed() { return !this.round || this.now() >= this.round.banzuke_date; }
  get submitted() { return !!this.submission && samePlacements(this.submission.placements, this.state.makuuchiPlacements()); }

  onChange() {
    this.message = null;
    this.render();
  }

  /** The server's word on the user's submission for this round, after registering or signing in/out. */
  onProfile({ profile, submission }) {
    if (this.round) {
      this.submission = submission ? { shikona: profile.shikona, ...submission } : null;
      saveSubmission(this.round.id, this.submission);
    }
    if (this.message === REGISTER_FIRST && profile.shikona) this.message = null;
    this.render();
  }

  onClick() {
    if (this.closed || this.submitted || this.sending) return;
    const problem = validateGuess(this.state);
    if (problem) { this.message = problem; this.render(); return; }
    if (!this.register.shikona) { this.message = REGISTER_FIRST; this.render(); this.register.open(); return; }
    this.send();
  }

  async send() {
    const placements = this.state.makuuchiPlacements();
    this.sending = true;
    this.render();
    try {
      const res = await this.fetch('/api/submit', { method: 'POST', body: { basho: this.round.id, placements } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        this.submission = { shikona: data.shikona || this.register.shikona, placements, submitted_at: data.submitted_at };
        saveSubmission(this.round.id, this.submission);
        this.message = null;
      } else if (data.error === 'not_registered') {
        this.message = REGISTER_FIRST;
        this.register.open();
      } else if (data.error === 'closed') {
        this.message = 'Submissions closed';
      } else if (data.error === 'bad_auth') {
        this.message = 'Sign in again';
      } else {
        this.message = 'Try again';
      }
    } catch {
      this.message = 'Try again';
    } finally {
      this.sending = false;
      this.render();
    }
  }

  /** Button text and whether it is clickable, from the current state. */
  status() {
    if (!this.round) return { text: 'No upcoming basho', enabled: false };
    if (this.closed) {
      return { text: this.round.reopens ? `Submissions closed\nuntil ${this.round.reopens}` : 'Submissions closed', enabled: false };
    }
    if (this.sending) return { text: 'Saving…', enabled: false };
    if (this.message) return { text: this.message, enabled: false, error: true };
    if (this.submitted) return { text: 'Saved', enabled: false };
    return { text: 'Save Guess', enabled: true };
  }

  render() {
    const { button, note } = this.els;
    const s = this.status();
    button.textContent = s.text;
    button.disabled = !s.enabled;
    button.classList.toggle('button-error', !!s.error);
    if (this.submission && this.round) {
      note.textContent = `Saved, come back ${formatDate(this.round.banzuke_date)}`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }
}
