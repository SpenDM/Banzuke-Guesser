// "Apply Ideal Promotions": a first-pass guess for every rikishi not yet placed, moving each
// one by their net score and leaving conflicts (shared slots, promotion candidates) to the user.
import {
  CANDIDATE_RANKS, RANK_ORDER, buildLadder, candidateSlotId, ladderPosition, ladderSlot, positionWithinType, slotId,
} from './rank.js';

// Absences count as losses, as they do for the real banzuke: 7-7-1 is a make-koshi (-1).
export const netScore = (r) => r.wins - r.losses - (r.absences || 0);

// The highest slot the score system can reach. Ozeki/Yokozuna promotion is decided on other
// criteria, so a Sekiwake whose score would carry them past the top of Sekiwake stops here.
const TOP_SLOT = slotId('S', 1, 'E');

const banzukeOrder = (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
  || positionWithinType(a.num, a.side) - positionWithinType(b.num, b.side);

/**
 * Slot ids for every unplaced, still-active rikishi: a Map of key -> slotId.
 * `placed` is the current guesses (key -> slotId); anyone in it is left alone, and the slots
 * it uses are skipped when re-ordering Yokozuna/Ozeki. `rowCounts` is the guess side's rows.
 */
export function idealPlacements(basho, placed, rowCounts) {
  const ladder = buildLadder(basho.rikishi);
  const out = new Map();
  const occupied = new Set(placed.values());
  const active = basho.rikishi.filter((r) => !r.retired && !placed.has(r.key)).sort(banzukeOrder);

  // Yokozuna and Ozeki keep their rank; they are only re-ordered within it by wins, with the
  // previous banzuke order breaking ties, into the slots nobody has been guessed into yet.
  for (const rank of ['Y', 'O']) {
    const group = active.filter((r) => r.rank === rank).sort((a, b) => b.wins - a.wins || banzukeOrder(a, b));
    const slots = [];
    for (let num = 1; num <= (rowCounts[rank] || 0); num++) for (const side of ['E', 'W']) slots.push(slotId(rank, num, side));
    const free = slots.filter((s) => !occupied.has(s));
    group.forEach((r, i) => out.set(r.key, free[i] ?? slots.at(-1) ?? slotId(rank, 1, 'E')));
  }

  // Everyone else moves by their net score, one rank number per point (E/W is a half step),
  // chained across rank types the same way the rank-change column counts them. Walking them in
  // banzuke order keeps a candidates row (or a shared slot) sorted by previous rank.
  for (const r of active) {
    if (r.rank === 'Y' || r.rank === 'O') continue;
    const slot = scoreSlot(ladder, r);
    if (slot) out.set(r.key, slot);
  }
  return out;
}

function scoreSlot(ladder, r) {
  const from = ladderPosition(ladder, r.rank, r.num, r.side);
  const target = from - netScore(r) * 2;
  const dest = ladderSlot(ladder, target);
  const fromIndex = RANK_ORDER.indexOf(r.rank);

  // Same type, or demoted into a lower one: the slot the score points at.
  if (dest && RANK_ORDER.indexOf(dest.rank) >= fromIndex) return slotId(dest.rank, dest.num, dest.side);
  // Off the bottom of Juryo: the lowest Juryo slot.
  if (!dest && target > from) {
    const nums = ladder.sorted.J;
    return nums.length ? slotId('J', nums.at(-1), 'W') : null;
  }
  // Would rise into a higher type. Komusubi/Maegashira/Juryo go to the candidates row between
  // their type and the one above (however far the score would carry them); a Sekiwake has no
  // such row, since Ozeki is not reached on score alone, and is capped at S1E instead.
  const above = RANK_ORDER[fromIndex - 1];
  return CANDIDATE_RANKS.includes(above) ? candidateSlotId(above) : TOP_SLOT;
}
