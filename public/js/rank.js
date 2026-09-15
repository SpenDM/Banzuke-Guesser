// Rank model: slot ids, ordering, and the rank-change calculation.

export const RANK_ORDER = ['Y', 'O', 'S', 'K', 'M', 'J'];
export const RANK_NAMES = { Y: 'Yokozuna', O: 'Ozeki', S: 'Sekiwake', K: 'Komusubi', M: 'Maegashira', J: 'Juryo' };
export const DIVISION_OF = { Y: 'makuuchi', O: 'makuuchi', S: 'makuuchi', K: 'makuuchi', M: 'makuuchi', J: 'juryo' };

// Default row template for the guess banzuke. Named ranks get a spare row each.
export const DEFAULT_GUESS_ROWS = [
  ['Y', 2], ['O', 3], ['S', 2], ['K', 2], ['M', 17], ['J', 14],
].flatMap(([rank, count]) => Array.from({ length: count }, (_, i) => ({ rank, num: i + 1 })));

export function slotId(rank, num, side) {
  return `${rank}${num}${side}`;
}

const SLOT_RE = /^([YOSKMJ])(\d+)([EW])$/;
export function parseSlot(id) {
  const m = SLOT_RE.exec(id);
  if (!m) throw new Error(`bad slot id: ${id}`);
  return { rank: m[1], num: Number(m[2]), side: m[3] };
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

export function compareSlots(a, b) {
  const ra = RANK_ORDER.indexOf(a.rank), rb = RANK_ORDER.indexOf(b.rank);
  if (ra !== rb) return ra - rb;
  return positionWithinType(a.num, a.side) - positionWithinType(b.num, b.side);
}

/**
 * Rank change from `from` to `to` (both {rank, num, side}).
 * Same rank type -> signed half-steps, e.g. "+0.5", "-4.5", "0".
 * Different type -> arrow + new type, e.g. "↑K", "↓J".
 * Returns { text, value, kind } where kind is 'up' | 'down' | 'same'.
 */
export function rankChange(from, to) {
  if (from.rank === to.rank) {
    const value = (positionWithinType(from.num, from.side) - positionWithinType(to.num, to.side)) / 2;
    const kind = value > 0 ? 'up' : value < 0 ? 'down' : 'same';
    const text = value === 0 ? '0' : `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
    return { text, value, kind };
  }
  const up = RANK_ORDER.indexOf(to.rank) < RANK_ORDER.indexOf(from.rank);
  return { text: `${up ? '↑' : '↓'}${to.rank}`, value: null, kind: up ? 'up' : 'down' };
}
