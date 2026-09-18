// Guess state: which slot each rikishi has been dragged to, plus the guess-table row layout.
import {
  CANDIDATE_RANKS, DEFAULT_GUESS_ROWS, DIVISION_OF, MAX_SANYAKU_ROWS, MIN_SANYAKU_ROWS, candidateRowSlots, compareSlots,
  parseSlot, slotId,
} from './rank.js';
import { idealPlacements } from './promote.js';

export class GuessState extends EventTarget {
  constructor(basho) {
    super();
    this.basho = basho;
    this.rikishi = new Map(basho.rikishi.map((r) => [r.key, r]));
    this.guesses = new Map();               // key -> slotId
    // rank -> number of numbered rows on the guess side. Sanyaku ranks start with exactly as
    // many rows as the previous banzuke had; Maegashira/Juryo with the template, or more if the
    // previous banzuke was longer.
    this.rowCounts = { Y: MIN_SANYAKU_ROWS, O: MIN_SANYAKU_ROWS, S: MIN_SANYAKU_ROWS, K: MIN_SANYAKU_ROWS };
    for (const { rank, num } of DEFAULT_GUESS_ROWS) this.rowCounts[rank] = Math.max(this.rowCounts[rank] || 0, num);
    for (const r of basho.rikishi) this.rowCounts[r.rank] = Math.max(this.rowCounts[r.rank], r.num);
  }

  #emit() { this.dispatchEvent(new Event('change')); }

  /** Restore a snapshot produced by toJSON(); ignores rikishi/slots that no longer exist. */
  load(snapshot) {
    if (!snapshot || snapshot.basho !== this.basho.id) return false;
    for (const [rank, n] of Object.entries(snapshot.rowCounts || {})) {
      if (rank in this.rowCounts && Number.isInteger(n)) this.rowCounts[rank] = Math.max(this.rowCounts[rank], n);
    }
    for (const [key, slot] of Object.entries(snapshot.guesses || {})) {
      try { parseSlot(slot); } catch { continue; }
      if (this.rikishi.has(key)) this.guesses.set(key, slot);
    }
    return true;
  }

  place(key, slotId) {
    if (!this.rikishi.has(key)) return;
    parseSlot(slotId); // validates
    this.guesses.set(key, slotId);
    this.#emit();
  }

  remove(key) {
    if (this.guesses.delete(key)) this.#emit();
  }

  reset() {
    this.guesses.clear();
    this.#emit();
  }

  /**
   * Places every unplaced rikishi by their net score and indicators (see promote.js); placed ones
   * are untouched. Adopts any sanyaku rows the placement had to add.
   */
  applyIdealPromotions() {
    const { placements, rowCounts } = idealPlacements(this.basho, this.guesses, this.rowCounts);
    this.rowCounts = rowCounts;
    for (const [key, slot] of placements) this.guesses.set(key, slot);
    if (placements.size) this.#emit();
  }

  addRow(rank) {
    if (this.rowCounts[rank] >= MAX_SANYAKU_ROWS) return;
    this.rowCounts[rank] += 1;
    this.#emit();
  }

  /** Drops the rank's highest-numbered row, unplacing anyone guessed into it. */
  removeRow(rank) {
    if (this.rowCounts[rank] <= MIN_SANYAKU_ROWS) return;
    const num = this.rowCounts[rank];
    for (const side of ['E', 'W']) {
      const slot = slotId(rank, num, side);
      for (const [key, s] of this.guesses) if (s === slot) this.guesses.delete(key);
    }
    this.rowCounts[rank] -= 1;
    this.#emit();
  }

  slotOf(key) { return this.guesses.get(key) || null; }

  occupants(slotId) {
    const keys = [];
    for (const [key, slot] of this.guesses) if (slot === slotId) keys.push(key);
    return keys.map((k) => this.rikishi.get(k));
  }

  /**
   * Guess-table rows in order: {rank, num} for numbered rows, plus {rank, candidates: true}
   * right after a type's numbered rows whenever any slot of its candidates row has occupants
   * (so the row disappears as soon as the last candidate is moved out).
   */
  rows() {
    const out = [];
    const slots = new Set(this.guesses.values());
    for (const rank of ['Y', 'O', 'S', 'K', 'M', 'J']) {
      for (let num = 1; num <= this.rowCounts[rank]; num++) out.push({ rank, num });
      if (CANDIDATE_RANKS.includes(rank) && candidateRowSlots(rank).some((s) => slots.has(s))) out.push({ rank, candidates: true });
    }
    return out;
  }

  /**
   * Progress: `spots` is the size of Makuuchi (the previous banzuke's headcount), `filled` how
   * many numbered Makuuchi slots hold exactly one rikishi. Empty and shared slots don't count,
   * nor do the candidates rows.
   */
  counts() {
    const spots = this.basho.rikishi.filter((r) => r.division === 'makuuchi').length;
    const perSlot = new Map();
    for (const slot of this.guesses.values()) perSlot.set(slot, (perSlot.get(slot) || 0) + 1);
    let filled = 0;
    for (const [slot, n] of perSlot) {
      const s = parseSlot(slot);
      if (n === 1 && !s.candidates && DIVISION_OF[s.rank] === 'makuuchi') filled++;
    }
    return { spots, filled };
  }

  /**
   * What gets submitted: every rikishi guessed into a numbered Makuuchi slot, in banzuke order, as
   * {slot, key, rikishi_id, name}. Candidates rows and Juryo are left out (see validateGuess).
   */
  makuuchiPlacements() {
    const out = [];
    for (const [key, slot] of this.guesses) {
      const s = parseSlot(slot);
      if (s.candidates || DIVISION_OF[s.rank] !== 'makuuchi') continue;
      const r = this.rikishi.get(key);
      out.push({ slot, key, rikishi_id: r.rikishi_id ?? null, name: r.name });
    }
    return out.sort((a, b) => compareSlots(parseSlot(a.slot), parseSlot(b.slot)));
  }

  toJSON() { return { basho: this.basho.id, guesses: Object.fromEntries(this.guesses), rowCounts: this.rowCounts }; }
}
