// "Save Guess": checks the prediction is a complete Makuuchi banzuke and saves it through the
// API (functions/api/submit.js) under the shikona the user registered (register.js). Owns the
// button's text/enabled state.
import { DIVISION_OF, RANK_ORDER, compareSlots, parseSlot, slotId, slotName } from './rank.js';
import { formatDate, todayJST } from './dates.js';
import { loadSubmission, saveSubmission } from './storage.js';
import { api } from './auth.js';

const MAKUUCHI_RANKS = RANK_ORDER.filter((rank) => DIVISION_OF[rank] === 'makuuchi');

/**
 * Why the prediction cannot be submitted yet, or null when it can. Checked in order:
 * the Makuuchi headcount (rikishi in numbered Makuuchi slots or still in a ↑ candidates row),
 * slots holding more than one rikishi (and candidates left in a ↑ row), then gaps: an empty slot
 * above a filled one of the same rank type (except the East side of a sanyaku rank's last row).
 */
export function validateGuess(state) {
  const { spots } = state.counts();
  const perSlot = new Map();
  for (const slot of state.guesses.values()) perSlot.set(slot, (perSlot.get(slot) || 0) + 1);
  const numbered = [];
  const unplaced = [];
  let total = 0;
  for (const [slot, n] of perSlot) {
    const s = parseSlot(slot);
    if (s.candidates === 'up') { unplaced.push(slot); total += n; }
    else if (!s.candidates && DIVISION_OF[s.rank] === 'makuuchi') { numbered.push(slot); total += n; }
  }
  if (total < spots) return 'Not enough rikishi!';
  if (total > spots) return 'Too many rikishi!';

  numbered.sort((a, b) => compareSlots(parseSlot(a), parseSlot(b)));
  const multi = numbered.find((slot) => perSlot.get(slot) > 1);
  if (multi) return `Multiple at ${multi}`;
  if (unplaced.length) {
    unplaced.sort((a, b) => compareSlots(parseSlot(a), parseSlot(b)));
    return `Unplaced at ${slotName(unplaced[0])}`;
  }

  for (const rank of MAKUUCHI_RANKS) {
    // A sanyaku rank's lowest filled row may have either side empty (e.g. Nagoya 2025: S2W with
    // no S2E), so for those only the rows above it must be full.
    const sanyaku = rank !== 'M';
    let lastFilledRow = 0;
    if (sanyaku) {
      for (let num = 1; num <= state.rowCounts[rank]; num++) {
        if (perSlot.has(slotId(rank, num, 'E')) || perSlot.has(slotId(rank, num, 'W'))) lastFilledRow = num;
      }
    }
    let firstEmpty = null;
    for (let num = 1; num <= state.rowCounts[rank]; num++) {
      for (const side of ['E', 'W']) {
        const slot = slotId(rank, num, side);
        if (!perSlot.has(slot)) firstEmpty ??= slot;
        else if (firstEmpty && !(sanyaku && num === lastFilledRow && parseSlot(firstEmpty).num === num)) {
          return `Gap at ${firstEmpty}`;
        }
      }
    }
  }
  return null;
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
