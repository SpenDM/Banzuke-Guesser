// Scores a submitted Makuuchi prediction against the announced banzuke.
//
// 1 point for every rikishi in the right slot, plus 1 point for every correct neighbour pairing:
// two rikishi that follow each other on the real banzuke (in Y1E, Y1W, O1E, … order) and also
// follow each other, in that order, in the prediction. So a group shifted down one slot by a single
// wrong placement keeps its pairing points, while the same group jumbled loses them:
// for the real order ABCD, DABC scores 2, ABDC 3, DACB 1 and ABCD itself 4 + 3 = 7.
import { compareSlots, parseSlot } from './rank.js';

/** Placements sorted into banzuke order. */
export const linearize = (placements) => [...placements].sort((a, b) => compareSlots(parseSlot(a.slot), parseSlot(b.slot)));

/**
 * Finds each guessed rikishi on the actual banzuke: by rikishi id when both sides have one (it
 * survives shikona changes between the two banzuke), by key otherwise.
 */
function matcher(actual) {
  const byId = new Map();
  const byKey = new Map();
  actual.forEach((r, i) => {
    if (r.rikishi_id != null) byId.set(r.rikishi_id, i);
    byKey.set(r.key, i);
  });
  return (p) => {
    if (p.rikishi_id != null && byId.has(p.rikishi_id)) return byId.get(p.rikishi_id);
    return byKey.has(p.key) ? byKey.get(p.key) : -1;
  };
}

/**
 * { placements, neighbors, total, correctSlots, gtb, gtbHits } — `correctSlots` names the slots (shared by both
 * tables) where the prediction has the right rikishi. `guess` and `actual` are lists of
 * {slot, key, rikishi_id, name}.
 */
export function scoreGuess(guess, actual) {
  const real = linearize(actual);
  const find = matcher(real);
  const mine = linearize(guess);
  const correctSlots = new Set();
  let placements = 0;
  let neighbors = 0;
  let prev = -1;
  for (const p of mine) {
    const i = find(p);
    if (i >= 0 && real[i].slot === p.slot) { placements++; correctSlots.add(p.slot); }
    // A correct pairing: this rikishi immediately follows the previous one on the real banzuke too.
    if (i >= 0 && prev >= 0 && i === prev + 1) neighbors++;
    prev = i;
  }
  return { placements, neighbors, total: placements + neighbors, correctSlots, ...scoreGtb(guess, actual) };
}

/**
 * The Guess the Banzuke (GTB) score, { gtb, gtbHits }: 2 points for a rikishi on the right rank and
 * side (a bulls-eye, e.g. M5E), 1 point for the right rank on the other side (M5W). `gtbHits`
 * counts both kinds, GTB's first tiebreaker ("most total guesses"). Sanyaku ranks are numbered like
 * the rest (S2E is its own rank), and candidate-row placements have no rank, so they score nothing.
 */
export function scoreGtb(guess, actual) {
  const find = matcher(actual);
  let gtb = 0;
  let gtbHits = 0;
  for (const p of guess) {
    const i = find(p);
    if (i < 0) continue;
    const mine = parseSlot(p.slot);
    const real = parseSlot(actual[i].slot);
    if (mine.num == null || mine.rank !== real.rank || mine.num !== real.num) continue;
    gtb += mine.side === real.side ? 2 : 1;
    gtbHits++;
  }
  return { gtb, gtbHits };
}

/** How the leaderboard can be ordered: by this app's total, or by the GTB score. */
export const LEADERBOARD_ORDERS = {
  total: (a, b) => b.total - a.total || b.placements - a.placements,
  gtb: (a, b) => b.gtb - a.gtb || b.gtbHits - a.gtbHits,
};

/**
 * Leaderboard order: by `order` (see LEADERBOARD_ORDERS; total, then correct placements by
 * default), then shikona; equal scores share a position.
 */
export function rankSubmissions(scored, order = 'total') {
  const better = LEADERBOARD_ORDERS[order];
  const out = [...scored].sort((a, b) => better(a, b) || a.shikona.localeCompare(b.shikona));
  return out.map((s) => {
    const position = 1 + out.filter((o) => better(o, s) < 0).length;
    const tied = out.filter((o) => better(o, s) === 0).length > 1;
    return { ...s, position, tied, label: `${tied ? 'T-' : ''}${position}` };
  });
}
