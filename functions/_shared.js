// Helpers shared by the Pages Functions in functions/api. Not a route: it exports no onRequest*.
import { firebaseConfig } from '../public/js/firebase-config.js';
import { verifyIdToken } from './firebase.js';

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export const error = (code, status, extra = {}) => json({ error: code, ...extra }, status);

// The browser token identifying an anonymous user (see getToken() in public/js/storage.js): a
// UUID, or any hex string of at least 32 characters.
const TOKEN_RE = /^[0-9a-f-]{32,64}$/i;
export function tokenOf(request) {
  const t = (request.headers.get('x-guesser-token') || '').trim();
  return TOKEN_RE.test(t) ? t.toLowerCase() : null;
}

/**
 * Who is calling: { id, token, account } where `id` is the user_id rows are keyed on — `fb:<uid>`
 * of the Firebase account the `Authorization: Bearer <ID token>` header proves (public/js/auth.js),
 * else the browser token — or { error } (`bad_auth`: a bearer token that does not verify;
 * `bad_token`: neither identifies the caller). When a request carries both, the browser token's
 * registration and submissions are folded into the account first (see absorb()), so a user who
 * signs in keeps what they did anonymously in this browser.
 */
export async function identify(request, env) {
  const token = tokenOf(request);
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  const account = bearer ? await verifyIdToken(bearer, firebaseConfig.projectId) : null;
  if (bearer && !account) return { error: 'bad_auth' };
  if (!account && !token) return { error: 'bad_token' };
  const id = account ? `fb:${account.uid}` : token;
  if (account && token) await absorb(env.DB, token, id);
  return { id, token, account };
}

/**
 * Folds the anonymous identity `token` into `id`: its registration moves over unless `id` already
 * has one (then it is dropped — the account's shikona wins), and so do its submissions, except for
 * rounds the account already submitted. Every statement is a no-op once this has happened, so it
 * is safe on every request.
 */
export async function absorb(db, token, id) {
  await db.batch([
    db.prepare('DELETE FROM users WHERE user_id = ?1 AND EXISTS (SELECT 1 FROM users WHERE user_id = ?2)').bind(token, id),
    db.prepare('UPDATE users SET user_id = ?2, updated_at = ?3 WHERE user_id = ?1').bind(token, id, new Date().toISOString()),
    db.prepare('DELETE FROM submissions WHERE user_id = ?1 AND basho_id IN (SELECT basho_id FROM submissions WHERE user_id = ?2)').bind(token, id),
    db.prepare('UPDATE submissions SET user_id = ?2 WHERE user_id = ?1').bind(token, id),
    db.prepare(`UPDATE submissions SET shikona = (SELECT shikona FROM users WHERE user_id = ?1)
                WHERE user_id = ?1 AND EXISTS (SELECT 1 FROM users WHERE user_id = ?1)`).bind(id),
  ]);
}

export const SHIKONA_MAX = 30;
/** The shikona normalised (trimmed, single spaces), or null when not a 1–30 character string. */
export function validateShikona(shikona) {
  if (typeof shikona !== 'string') return null;
  const s = shikona.trim().replace(/\s+/g, ' ');
  return s && s.length <= SHIKONA_MAX ? s : null;
}

/**
 * The caller's profile as /api/me and /api/register answer it: their shikona (null until they
 * register), whether they are signed in, and their submission for the round `basho` if asked.
 */
export async function profile(db, who, basho) {
  const [user, submission] = await Promise.all([
    db.prepare('SELECT shikona FROM users WHERE user_id = ?1').bind(who.id).first(),
    basho && /^\d{6}$/.test(basho)
      ? db.prepare('SELECT placements, submitted_at FROM submissions WHERE basho_id = ?1 AND user_id = ?2').bind(basho, who.id).first()
      : null,
  ]);
  return {
    shikona: user?.shikona ?? null,
    signed_in: !!who.account,
    provider: who.account?.provider ?? null,
    submission: submission ? { placements: JSON.parse(submission.placements), submitted_at: submission.submitted_at } : null,
  };
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
