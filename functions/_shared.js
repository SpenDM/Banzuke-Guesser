// Helpers shared by the Pages Functions in functions/api. Not a route: it exports no onRequest*.

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export const error = (code, status, extra = {}) => json({ error: code, ...extra }, status);

// The browser token identifying a user (see getToken() in public/js/storage.js): a UUID, or any
// hex string of at least 32 characters.
const TOKEN_RE = /^[0-9a-f-]{32,64}$/i;
export function tokenOf(request) {
  const t = (request.headers.get('x-guesser-token') || '').trim();
  return TOKEN_RE.test(t) ? t.toLowerCase() : null;
}

/** Today's date in Japan (YYYY-MM-DD), where the announcement and the tournament days are counted. */
export function todayJST(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * A JSON file of the static site (public/…) as this deployment serves it, or null when it is not
 * there. Pages answers unknown paths with index.html and a 200 (the single-page-app fallback), so
 * the content type is checked as well as the status.
 */
export async function readAsset(env, request, path) {
  const res = await env.ASSETS.fetch(new URL(path, request.url));
  const type = res.headers.get('content-type') || '';
  return res.ok && type.includes('application/json') ? res : null;
}

const BASHO_ID_RE = /^\d{6}$/;
/** The scheduled tournament with this id, from data/schedule.json, or null. */
export async function tournamentOf(env, request, bashoId) {
  if (!BASHO_ID_RE.test(bashoId || '')) return null;
  const res = await readAsset(env, request, '/data/schedule.json');
  if (!res) return null;
  const schedule = await res.json();
  return schedule.find((t) => t.id === bashoId) || null;
}

/** Whether the announced banzuke of this tournament has been published (data/banzuke/YYYYMM.json). */
export async function banzukePublished(env, request, bashoId) {
  if (!BASHO_ID_RE.test(bashoId || '')) return false;
  return !!(await readAsset(env, request, `/data/banzuke/${bashoId}.json`));
}

export const clientIp = (request) => request.headers.get('cf-connecting-ip') || null;
