// "Submit Guess": checks the prediction is a complete Makuuchi banzuke, asks for a shikona and
// saves it through the API (functions/api/submit.js). Owns the button's text/enabled state.
import { DIVISION_OF, RANK_ORDER, compareSlots, parseSlot, slotId, slotName } from './rank.js';
import { formatDate, todayJST } from './dates.js';
import { getToken, loadSubmission, saveSubmission } from './storage.js';

const MAKUUCHI_RANKS = RANK_ORDER.filter((rank) => DIVISION_OF[rank] === 'makuuchi');

/**
 * Why the prediction cannot be submitted yet, or null when it can. Checked in order:
 * the Makuuchi headcount (rikishi in numbered Makuuchi slots or still in a ↑ candidates row),
 * slots holding more than one rikishi (and candidates left in a ↑ row), then gaps: an empty slot
 * above a filled one of the same rank type.
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
    let firstEmpty = null;
    for (let num = 1; num <= state.rowCounts[rank]; num++) {
      for (const side of ['E', 'W']) {
        const slot = slotId(rank, num, side);
        if (!perSlot.has(slot)) firstEmpty ??= slot;
        else if (firstEmpty) return `Gap at ${firstEmpty}`;
      }
    }
  }
  return null;
}

const samePlacements = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The submit button, the "<shikona>, come back <date>" note and the shikona popover.
 * `round` is the tournament being predicted ({id, name, banzuke_date, reopens}, `reopens` being
 * the formatted day the next round opens); `els` the elements {button, note, box, form, input, error}.
 */
export class SubmitController {
  constructor(state, round, els, { fetchImpl = fetch, now = todayJST } = {}) {
    this.state = state;
    this.round = round;
    this.els = els;
    this.fetch = (...args) => fetchImpl(...args);   // window.fetch must not be called with `this` rebound
    this.now = now;
    this.submission = round ? loadSubmission(round.id) : null;
    this.message = null;      // a validation/API message shown on the button until the next change
    this.asking = false;      // the shikona popover is open
    state.addEventListener('change', () => this.onChange());
    els.button.addEventListener('click', () => this.onClick());
    els.form.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.render();
  }

  get closed() { return !this.round || this.now() >= this.round.banzuke_date; }
  get submitted() { return !!this.submission && samePlacements(this.submission.placements, this.state.makuuchiPlacements()); }

  onChange() {
    this.message = null;
    this.asking = false;
    this.render();
  }

  onClick() {
    if (this.closed || this.submitted) return;
    const problem = validateGuess(this.state);
    if (problem) { this.message = problem; this.render(); return; }
    this.asking = true;
    this.render();
    this.els.input.value = this.submission?.shikona || this.els.input.value;
    this.els.input.focus();
  }

  async send() {
    const shikona = this.els.input.value.trim().replace(/\s+/g, ' ');
    if (!shikona) { this.showFormError('Enter a shikona'); return; }
    const placements = this.state.makuuchiPlacements();
    this.els.form.querySelector('button').disabled = true;
    this.showFormError('');
    try {
      const res = await this.fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-guesser-token': getToken() },
        body: JSON.stringify({ basho: this.round.id, shikona, placements }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        this.submission = { shikona: data.shikona || shikona, placements, submitted_at: data.submitted_at };
        saveSubmission(this.round.id, this.submission);
        this.asking = false;
        this.message = null;
      } else if (data.error === 'shikona_taken') {
        this.showFormError('Shikona taken');
      } else if (data.error === 'closed') {
        this.asking = false;
        this.message = 'Submissions closed';
      } else {
        this.showFormError(data.error === 'bad_shikona' ? 'Shikona must be 1–30 characters' : 'Try again');
      }
    } catch {
      this.showFormError('Try again');
    } finally {
      this.els.form.querySelector('button').disabled = false;
      this.render();
    }
  }

  showFormError(text) { this.els.error.textContent = text; }

  /** Button text and whether it is clickable, from the current state. */
  status() {
    if (!this.round) return { text: 'No upcoming basho', enabled: false };
    if (this.closed) {
      return { text: this.round.reopens ? `Submissions closed until ${this.round.reopens}` : 'Submissions closed', enabled: false };
    }
    if (this.message) return { text: this.message, enabled: false, error: true };
    if (this.asking) return { text: 'Enter your shikona', enabled: false };
    if (this.submitted) return { text: 'Submitted', enabled: false };
    return { text: this.submission ? 'Resubmit Guess' : 'Submit Guess', enabled: true };
  }

  render() {
    const { button, note, box } = this.els;
    const s = this.status();
    button.textContent = s.text;
    button.disabled = !s.enabled;
    button.classList.toggle('button-error', !!s.error);
    box.hidden = !this.asking;
    if (!this.asking) this.showFormError('');
    if (this.submission && this.round) {
      note.textContent = `${this.submission.shikona}, come back ${formatDate(this.round.banzuke_date)}`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }
}
