// Guess state: which slot each rikishi has been dragged to, plus the guess-table row layout.
import { DEFAULT_GUESS_ROWS, parseSlot } from './rank.js';

export class GuessState extends EventTarget {
  constructor(basho) {
    super();
    this.basho = basho;
    this.rikishi = new Map(basho.rikishi.map((r) => [r.key, r]));
    this.guesses = new Map();               // key -> slotId
    this.rowCounts = {};                    // rank -> number of numbered rows on the guess side
    for (const { rank, num } of DEFAULT_GUESS_ROWS) this.rowCounts[rank] = Math.max(this.rowCounts[rank] || 0, num);
    // Make sure the previous banzuke's named-rank rows all exist (e.g. a third Ozeki).
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

  addRow(rank) {
    this.rowCounts[rank] += 1;
    this.#emit();
  }

  slotOf(key) { return this.guesses.get(key) || null; }

  occupants(slotId) {
    const keys = [];
    for (const [key, slot] of this.guesses) if (slot === slotId) keys.push(key);
    return keys.map((k) => this.rikishi.get(k));
  }

  rows() {
    const out = [];
    for (const rank of ['Y', 'O', 'S', 'K', 'M', 'J']) {
      for (let num = 1; num <= this.rowCounts[rank]; num++) out.push({ rank, num });
    }
    return out;
  }

  counts() {
    const total = this.basho.rikishi.length;
    const placed = this.guesses.size;
    const unplacedMakuuchi = this.basho.rikishi.filter((r) => r.division === 'makuuchi' && !this.guesses.has(r.key)).length;
    return { total, placed, unplaced: total - placed, unplacedMakuuchi };
  }

  toJSON() { return { basho: this.basho.id, guesses: Object.fromEntries(this.guesses), rowCounts: this.rowCounts }; }
}
