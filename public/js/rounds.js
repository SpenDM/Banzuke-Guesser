// A "round" is one run of the game: predicting the banzuke of tournament N+1 from the results
// file of tournament N. Rounds are identified by the results file (data/basho/<id>.json) and
// named after the tournament being predicted.
import { formatDate } from './dates.js';

const MONTH_NAMES = { '01': 'January', '03': 'March', '05': 'May', '07': 'July', '09': 'September', '11': 'November' };

/** The tournament after the one with this id (tournaments run in odd months). */
export function nextBashoId(id) {
  const year = Number(id.slice(0, 4));
  const month = Number(id.slice(4));
  return month === 11 ? `${year + 1}01` : `${year}${String(month + 2).padStart(2, '0')}`;
}

export function bashoName(id) {
  return `${MONTH_NAMES[id.slice(4)] || id.slice(4)} ${id.slice(0, 4)}`;
}

/** {fileId, roundId, year, name} for every results file, newest first. */
export function rounds(fileIds) {
  return [...fileIds].sort().reverse().map((fileId) => {
    const roundId = nextBashoId(fileId);
    return { fileId, roundId, year: roundId.slice(0, 4), name: bashoName(roundId) };
  });
}

/**
 * The day the next round opens: the tournament's final day ("Sep 27" from "2026-09-27"), its
 * results going up that evening (Japan time) once the last bout is in.
 */
export function reopenDate(endDate) {
  return endDate ? formatDate(endDate) : null;
}
