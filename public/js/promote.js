// "Apply Ideal Rank Changes": a first-pass guess for every rikishi not yet placed, moving each
// one by their net score and leaving conflicts (shared slots, promotion candidates) to the user.
// Moves at the top of the banzuke that are decided outside the score system (Yokozuna/Ozeki
// promotion, Ozeki demotion) use the indicators computed by the scraper (see rikishi flags).
import {
  CANDIDATE_RANKS, DEMOTION_SLOT, MAX_SANYAKU_ROWS, RANK_ORDER, buildLadder, candidateSlotId, ladderPosition, ladderSlot,
  positionWithinType, slotId,
} from './rank.js';

// Absences count as losses, as they do for the real banzuke: 7-7-1 is a make-koshi (-1).
export const netScore = (r) => r.wins - r.losses - (r.absences || 0);

export const KACHI_KOSHI = 8;
export const OZEKI_TARGET = 33;      // wins over three sanyaku basho for Ozeki promotion
export const OZEKI_RETURN_WINS = 10; // a just-demoted Ozeki regains the rank with this many

// Indicator outcomes, shared by the placement below and the chip badges.
/** Wins still needed this basho to reach the Ozeki target, or null when not on a run. */
export const ozekiRunNeeded = (r) => (r.ozeki_run == null ? null : OZEKI_TARGET - r.ozeki_run);
export const ozekiRunMet = (r) => r.ozeki_run != null && r.wins >= ozekiRunNeeded(r);
export const ozekiReturnMet = (r) => !!r.ozeki_return && r.wins >= OZEKI_RETURN_WINS;
export const tsunatoriMet = (r) => !!r.tsunatori && !!r.yusho;
export const kadobanFailed = (r) => !!r.kadoban && r.wins < KACHI_KOSHI;

// The highest slot the score system can reach. Ozeki/Yokozuna promotion is decided on other
// criteria, so a Sekiwake whose score would carry them past the top of Sekiwake stops here.
const TOP_SLOT = slotId('S', 1, 'E');

const banzukeOrder = (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
  || positionWithinType(a.num, a.side) - positionWithinType(b.num, b.side);
const byWins = (a, b) => b.wins - a.wins || banzukeOrder(a, b);

/**
 * Placements for every unplaced, still-active rikishi: { placements: Map of key -> slotId,
 * rowCounts } where `rowCounts` is a copy of the given one, grown (up to MAX_SANYAKU_ROWS) when a
 * Yokozuna/Ozeki/Sekiwake move needed a slot the rank did not have.
 * `placed` is the current guesses (key -> slotId); anyone in it is left alone and the slots it uses
 * count as taken. `rowCounts` is the guess side's rows.
 */
export function idealPlacements(basho, placed, rowCounts) {
  const ladder = buildLadder(basho.rikishi);
  const placements = new Map();
  const rows = { ...rowCounts };
  const active = basho.rikishi.filter((r) => !r.retired && !placed.has(r.key)).sort(banzukeOrder);

  // Moves decided by the indicators rather than the score. A Sekiwake regaining Ozeki comes
  // before one completing a run, so the returnee ends up higher.
  const promotedToY = active.filter((r) => r.rank === 'O' && tsunatoriMet(r));
  const demotedToS = active.filter((r) => r.rank === 'O' && kadobanFailed(r));
  const promotedToO = [
    ...active.filter((r) => r.rank === 'S' && ozekiReturnMet(r)),
    ...active.filter((r) => r.rank === 'S' && !ozekiReturnMet(r) && ozekiRunMet(r)),
  ];
  const special = new Set([...promotedToY, ...demotedToS, ...promotedToO].map((r) => r.key));

  // Everyone else below Yokozuna/Ozeki moves by their net score, one rank number per point (E/W
  // is a half step), chained across rank types the same way the rank-change column counts them.
  // Walking them in banzuke order keeps a candidates row (or a shared slot) sorted by previous rank.
  for (const r of active) {
    if (r.rank === 'Y' || r.rank === 'O' || special.has(r.key)) continue;
    const slot = scoreSlot(ladder, r);
    if (slot) placements.set(r.key, slot);
  }

  // Yokozuna and Ozeki keep their rank, re-ordered within it by wins (previous banzuke order
  // breaking ties); anyone promoted into the rank follows them, and a demoted Ozeki takes the
  // first Sekiwake slot left open by the score placements. Each list fills the rank's open slots
  // top-down, adding a row when it runs out.
  const incumbents = (rank) => active.filter((r) => r.rank === rank && !special.has(r.key)).sort(byWins);
  const fillRank = (rank, list) => {
    if (!list.length) return;
    const taken = new Set([...placed.values(), ...placements.values()]);
    const slotsOf = () => Array.from({ length: rows[rank] || 0 }, (_, i) => ['E', 'W'].map((side) => slotId(rank, i + 1, side))).flat();
    let slots = slotsOf();
    let free = slots.filter((s) => !taken.has(s));
    while (free.length < list.length && rows[rank] < MAX_SANYAKU_ROWS) {
      rows[rank] += 1;
      slots = slotsOf();
      free = slots.filter((s) => !taken.has(s));
    }
    list.forEach((r, i) => placements.set(r.key, free[i] ?? slots.at(-1) ?? slotId(rank, 1, 'E')));
  };
  fillRank('Y', [...incumbents('Y'), ...promotedToY]);
  fillRank('O', [...incumbents('O'), ...promotedToO]);
  fillRank('S', demotedToS);
  return { placements, rowCounts: rows };
}

function scoreSlot(ladder, r) {
  const from = ladderPosition(ladder, r.rank, r.num, r.side);
  const target = from - netScore(r) * 2;
  const dest = ladderSlot(ladder, target);
  const fromIndex = RANK_ORDER.indexOf(r.rank);

  // Same type, or demoted into a lower one: the slot the score points at, except that a
  // Makuuchi rikishi who would drop into Juryo becomes a demotion candidate instead.
  const demoted = dest ? RANK_ORDER.indexOf(dest.rank) >= fromIndex : target > from;
  if (demoted) {
    const intoJuryo = !dest || dest.rank === 'J';
    if (intoJuryo && r.rank !== 'J') return DEMOTION_SLOT;
    if (dest) return slotId(dest.rank, dest.num, dest.side);
    const nums = ladder.sorted.J; // off the bottom of Juryo: the lowest Juryo slot
    return nums.length ? slotId('J', nums.at(-1), 'W') : null;
  }
  // Would rise into a higher type. Komusubi/Maegashira/Juryo go to the candidates row between
  // their type and the one above (however far the score would carry them); a Sekiwake has no
  // such row, since Ozeki is not reached on score alone, and is capped at S1E instead.
  const above = RANK_ORDER[fromIndex - 1];
  return CANDIDATE_RANKS.includes(above) ? candidateSlotId(above) : TOP_SLOT;
}
