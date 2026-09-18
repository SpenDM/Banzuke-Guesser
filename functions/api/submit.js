// POST /api/submit  { basho, shikona, placements }  with header X-Guesser-Token.
// Saves (or replaces) the caller's Makuuchi prediction for the round `basho`, the tournament whose
// banzuke it will be scored against. One row per (basho, token); a shikona is one user's per round.
import { banzukePublished, clientIp, error, json, todayJST, tokenOf, tournamentOf } from '../_shared.js';

export const MAKUUCHI_SIZE = 42;
export const SHIKONA_MAX = 30;
const SLOT_RE = /^[YOSKM]\d{1,2}[EW]$/;

/** The placements list normalised, or a string naming what is wrong with it. */
export function validatePlacements(placements) {
  if (!Array.isArray(placements)) return 'placements must be a list';
  if (placements.length !== MAKUUCHI_SIZE) return `placements must hold exactly ${MAKUUCHI_SIZE} rikishi`;
  const slots = new Set();
  const who = new Set();
  const out = [];
  for (const p of placements) {
    if (!p || typeof p !== 'object') return 'bad placement';
    const { slot, key, name } = p;
    const id = p.rikishi_id == null ? null : p.rikishi_id;
    if (typeof slot !== 'string' || !SLOT_RE.test(slot)) return `bad slot ${JSON.stringify(slot)}`;
    if (typeof key !== 'string' || !key || key.length > 40) return 'bad rikishi key';
    if (typeof name !== 'string' || !name || name.length > 60) return 'bad rikishi name';
    if (id !== null && !Number.isInteger(id)) return 'bad rikishi id';
    if (slots.has(slot)) return `slot ${slot} used twice`;
    const identity = id ?? key;
    if (who.has(identity)) return `${name} placed twice`;
    slots.add(slot);
    who.add(identity);
    out.push({ slot, key, rikishi_id: id, name });
  }
  return out;
}

export function validateShikona(shikona) {
  if (typeof shikona !== 'string') return null;
  const s = shikona.trim().replace(/\s+/g, ' ');
  return s && s.length <= SHIKONA_MAX ? s : null;
}

export async function onRequestPost({ request, env }) {
  const token = tokenOf(request);
  if (!token) return error('bad_token', 400);
  let body;
  try { body = await request.json(); } catch { return error('bad_json', 400); }

  const tournament = await tournamentOf(env, request, body.basho);
  if (!tournament) return error('unknown_basho', 400);
  // Guesses close once the announcement day arrives (or the banzuke is already up).
  if (todayJST() >= tournament.banzuke_date || await banzukePublished(env, request, tournament.id)) {
    return error('closed', 403);
  }
  const shikona = validateShikona(body.shikona);
  if (!shikona) return error('bad_shikona', 400);
  const placements = validatePlacements(body.placements);
  if (typeof placements === 'string') return error('bad_placements', 400, { detail: placements });

  const taken = await env.DB.prepare(
    'SELECT user_id FROM submissions WHERE basho_id = ?1 AND shikona = ?2 COLLATE NOCASE AND user_id <> ?3',
  ).bind(tournament.id, shikona, token).first();
  if (taken) return error('shikona_taken', 409);

  const submittedAt = new Date().toISOString();
  try {
    await env.DB.prepare(`
      INSERT INTO submissions (basho_id, user_id, shikona, placements, ip, submitted_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT (basho_id, user_id) DO UPDATE SET
        shikona = excluded.shikona, placements = excluded.placements, ip = excluded.ip,
        submitted_at = excluded.submitted_at`,
    ).bind(tournament.id, token, shikona, JSON.stringify(placements), clientIp(request), submittedAt).run();
  } catch (e) {
    // Two users racing for the same shikona: the UNIQUE index catches what the SELECT above missed.
    if (/UNIQUE/i.test(String(e))) return error('shikona_taken', 409);
    throw e;
  }
  return json({ basho: tournament.id, shikona, submitted_at: submittedAt });
}
