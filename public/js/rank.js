// Rank model: slot ids, ordering, and the rank-change calculation.

export const RANK_ORDER = ['Y', 'O', 'S', 'K', 'M', 'J'];
export const RANK_NAMES = { Y: 'Yokozuna', O: 'Ozeki', S: 'Sekiwake', K: 'Komusubi', M: 'Maegashira', J: 'Juryo' };
export const DIVISION_OF = { Y: 'makuuchi', O: 'makuuchi', S: 'makuuchi', K: 'makuuchi', M: 'makuuchi', J: 'juryo' };
export const DIVISION_NAMES = { makuuchi: 'Makuuchi', juryo: 'Juryo' };

// Sanyaku rows alternate gold/bronze instead of the plain white used for Maegashira/Juryo.
export const SANYAKU_TINT = { Y: 'gold', O: 'bronze', S: 'gold', K: 'bronze' };

// How far the +/- row controls can adjust a sanyaku rank's row count on the guess side.
export const MIN_SANYAKU_ROWS = 1;
export const MAX_SANYAKU_ROWS = 3;

// Default row template for the guess banzuke's rank-and-file. Sanyaku ranks are not listed:
// each starts with as many rows as the previous banzuke had (see GuessState).
export const DEFAULT_GUESS_ROWS = [
  ['M', 18], ['J', 14],
].flatMap(([rank, count]) => Array.from({ length: count }, (_, i) => ({ rank, num: i + 1 })));

export function slotId(rank, num, side) {
  return `${rank}${num}${side}`;
}

// Candidates rows: a temporary guess row shown right below rank type `rank`'s numbered rows
// (between it and the type beneath). Its left half ("^S", "^K", "^M") holds rikishi whose result
// would carry them up into `rank`; the Maegashira/Juryo row's right half ("vJ") holds Makuuchi
// rikishi whose result would drop them into Juryo. A row exists only while someone occupies it.
// Ozeki/Yokozuna promotion is decided outside the score system, so there is no row for those.
export const CANDIDATE_RANKS = ['S', 'K', 'M'];
export const candidateSlotId = (rank) => `^${rank}`;
export const DEMOTION_SLOT = 'vJ';
/** Every slot id that lives in rank type `rank`'s candidates row. */
export const candidateRowSlots = (rank) => (rank === 'M' ? [candidateSlotId('M'), DEMOTION_SLOT] : [candidateSlotId(rank)]);

const SLOT_RE = /^([YOSKMJ])(\d+)([EW])$/;
const CANDIDATE_RE = /^\^([SKM])$/;
/**
 * Parses a slot id into {rank, num, side}, or {rank, candidates: 'up' | 'down'} for a
 * candidates slot (`rank` being the type it would move into).
 */
export function parseSlot(id) {
  if (id === DEMOTION_SLOT) return { rank: 'J', candidates: 'down' };
  const c = CANDIDATE_RE.exec(id);
  if (c) return { rank: c[1], candidates: 'up' };
  const m = SLOT_RE.exec(id);
  if (!m) throw new Error(`bad slot id: ${id}`);
  return { rank: m[1], num: Number(m[2]), side: m[3] };
}

/** Human-readable slot id: numbered slots as-is ("M2E"), a candidates slot as "↑K" / "↓J". */
export function slotName(id) {
  const s = parseSlot(id);
  if (!s.candidates) return id;
  return `${s.candidates === 'up' ? '↑' : '↓'}${s.rank}`;
}

export function rowLabel(rank, num) {
  return `${rank}${num}`;
}

export function slotLabel(rank, num, side) {
  return `${rank}${num}${side}`;
}

// Half-step position within a rank type: E is one half-step above W of the same number.
export function positionWithinType(num, side) {
  return num * 2 + (side === 'W' ? 1 : 0);
}

// A promotion-candidates slot sorts after every numbered row of its rank type; the demotion
// slot (candidates for Juryo) sits above Juryo's numbered rows.
const slotPosition = (s) => {
  if (s.candidates) return s.candidates === 'up' ? Infinity : -Infinity;
  return positionWithinType(s.num, s.side);
};

export function compareSlots(a, b) {
  const ra = RANK_ORDER.indexOf(a.rank), rb = RANK_ORDER.indexOf(b.rank);
  if (ra !== rb) return ra - rb;
  return slotPosition(a) - slotPosition(b);
}

function formatSigned(value) {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
}

/**
 * Builds, from a basho's actual rikishi list, what rankChange() needs to bridge between
 * rank types: for each type, which rank-and-file numbers are actually occupied (by either
 * side) and where that type starts on a single half-step ladder spanning every type.
 * A numbered row nobody currently holds (e.g. a vacant Sekiwake 2) takes up no space on
 * the ladder, so crossing it doesn't add to the rank-change count.
 */
export function buildLadder(rikishiList) {
  const numsByRank = {};
  for (const r of rikishiList) (numsByRank[r.rank] ??= new Set()).add(r.num);
  const sorted = {};
  for (const rank of RANK_ORDER) sorted[rank] = [...(numsByRank[rank] ?? [])].sort((a, b) => a - b);
  const offset = {};
  let running = 0;
  for (const rank of RANK_ORDER) {
    offset[rank] = running;
    running += sorted[rank].length * 2;
  }
  return { sorted, offset };
}

export function ladderPosition(ladder, rank, num, side) {
  const nums = ladder.sorted[rank] ?? [];
  const occupiedAtOrBefore = nums.filter((n) => n <= num).length;
  return ladder.offset[rank] + occupiedAtOrBefore * 2 + (side === 'W' ? 1 : 0);
}

/** Inverse of ladderPosition: the {rank, num, side} at half-step `pos`, or null past either end. */
export function ladderSlot(ladder, pos) {
  for (const rank of RANK_ORDER) {
    const nums = ladder.sorted[rank];
    const start = ladder.offset[rank] + 2;
    if (pos >= start && pos < start + nums.length * 2) {
      const i = pos - start;
      return { rank, num: nums[Math.floor(i / 2)], side: i % 2 ? 'W' : 'E' };
    }
  }
  return null;
}

/**
 * Rank change from `from` to `to` (both {rank, num, side}).
 * Same rank type -> signed half-steps, e.g. "+0.5", "-4.5", "0".
 * Different type -> the ORIGIN type with an arrow, e.g. "↓S" for a Sekiwake demoted to
 * Komusubi, plus (when `ladder` is given) a fainter half-step count chained across the
 * intervening types, counting only rows actually occupied in `ladder` (see buildLadder).
 * A candidates slot (`to.candidates`) has no fixed position, so it just shows "↑M" or "↓M".
 * Returns { text, value, kind, main, sub }: `kind` is 'up' | 'down' | 'same'; `main` is the
 * primary colored text; `sub` is the fainter suffix, or null for a same-type move.
 */
export function rankChange(from, to, ladder) {
  if (to.candidates) {
    const kind = to.candidates;
    const main = `${kind === 'up' ? '↑' : '↓'}${from.rank}`;
    return { text: main, value: null, kind, main, sub: null };
  }
  if (from.rank === to.rank) {
    const value = (positionWithinType(from.num, from.side) - positionWithinType(to.num, to.side)) / 2;
    const kind = value > 0 ? 'up' : value < 0 ? 'down' : 'same';
    const main = formatSigned(value);
    return { text: main, value, kind, main, sub: null };
  }
  const up = RANK_ORDER.indexOf(to.rank) < RANK_ORDER.indexOf(from.rank);
  const kind = up ? 'up' : 'down';
  const main = `${up ? '↑' : '↓'}${from.rank}`;
  if (!ladder) return { text: main, value: null, kind, main, sub: null };
  const value = (ladderPosition(ladder, from.rank, from.num, from.side)
    - ladderPosition(ladder, to.rank, to.num, to.side)) / 2;
  const sub = formatSigned(value);
  return { text: `${main} ${sub}`, value, kind, main, sub };
}
