// Date helpers. Schedule dates are ISO strings (YYYY-MM-DD) and count in Japan time.

/** "Oct 26" from "2026-10-26". */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Today's date in Japan as YYYY-MM-DD, comparable to the schedule's strings. */
export function todayJST(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
