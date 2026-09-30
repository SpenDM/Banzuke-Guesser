// POST /api/submit  { basho, placements, juryo?, makushita? }  with X-Guesser-Token and/or Authorization: Bearer <ID token>.
// Saves (or replaces) the caller's Makuuchi prediction for the round `basho`, the tournament whose
// banzuke it will be scored against, under the shikona they registered (/api/register; without
// one → 403 not_registered). `juryo`, optional, is their Juryo prediction, and `makushita`, optional
// (only with `juryo`), their prediction of the top of Makushita: kept and shown, never scored. One
// row per (basho, user).
import { banzukePublished, clientIp, error, identify, json, todayJST, tournamentOf } from '../_shared.js';

export const MAKUUCHI_SIZE = 42;
// Juryo has 28 slots; a prediction may leave some empty, or add a row. The prediction holds the top
// 15 rows of Makushita (30 slots).
export const JURYO_MAX = 40;
export const MAKUSHITA_MAX = 30;
const SLOT_RE = /^[YOSKM]\d{1,2}[EW]$/;
const LOWER = {
  juryo: { slot: /^J\d{1,2}[EW]$/, max: JURYO_MAX },
  makushita: { slot: /^Ms([1-9]|1[0-5])[EW]$/, max: MAKUSHITA_MAX },
};

/**
 * The placements list normalised, or a string naming what is wrong with it. `division`: validate
 * a 'juryo' or 'makushita' list instead of Makuuchi (any length up to its max, that division's
 * slots only; Makushita down to Ms15); `taken`, the identities (rikishi id, else key) already
 * placed in a division above, which may not appear again.
 */
export function validatePlacements(placements, { division = null, taken = new Set() } = {}) {
  const what = division || 'placements';
  const lower = division && LOWER[division];
  if (!Array.isArray(placements)) return `${what} must be a list`;
  if (lower ? placements.length > lower.max : placements.length !== MAKUUCHI_SIZE) {
    return lower ? `${what} may hold at most ${lower.max} rikishi` : `placements must hold exactly ${MAKUUCHI_SIZE} rikishi`;
  }
  const slots = new Set();
  const who = new Set(taken);
  const out = [];
  for (const p of placements) {
    if (!p || typeof p !== 'object') return 'bad placement';
    const { slot, key, name } = p;
    const id = p.rikishi_id == null ? null : p.rikishi_id;
    if (typeof slot !== 'string' || !(lower ? lower.slot : SLOT_RE).test(slot)) return `bad slot ${JSON.stringify(slot)}`;
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

export async function onRequestPost({ request, env }) {
  const who = await identify(request, env);
  if (who.error) return error(who.error, who.error === 'bad_auth' ? 401 : 400);
  let body;
  try { body = await request.json(); } catch { return error('bad_json', 400); }

  const tournament = await tournamentOf(env, request, body.basho);
  if (!tournament) return error('unknown_basho', 400);
  // Guesses close once the announcement day arrives (or the banzuke is already up).
  if (todayJST() >= tournament.banzuke_date || await banzukePublished(env, request, tournament.id)) {
    return error('closed', 403);
  }
  const placements = validatePlacements(body.placements);
  if (typeof placements === 'string') return error('bad_placements', 400, { detail: placements });
  const identity = (p) => p.rikishi_id ?? p.key;
  const juryo = body.juryo == null ? null
    : validatePlacements(body.juryo, { division: 'juryo', taken: new Set(placements.map(identity)) });
  if (typeof juryo === 'string') return error('bad_placements', 400, { detail: juryo });
  if (body.makushita != null && !juryo) return error('bad_placements', 400, { detail: 'makushita needs juryo' });
  const makushita = body.makushita == null ? null
    : validatePlacements(body.makushita, { division: 'makushita', taken: new Set([...placements, ...juryo].map(identity)) });
  if (typeof makushita === 'string') return error('bad_placements', 400, { detail: makushita });
  const shikona = await env.DB.prepare('SELECT shikona FROM users WHERE user_id = ?1').bind(who.id).first('shikona');
  if (!shikona) return error('not_registered', 403);

  const submittedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO submissions (basho_id, user_id, shikona, placements, juryo, makushita, ip, submitted_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT (basho_id, user_id) DO UPDATE SET
      shikona = excluded.shikona, placements = excluded.placements, juryo = excluded.juryo,
      makushita = excluded.makushita, ip = excluded.ip, submitted_at = excluded.submitted_at`,
  ).bind(tournament.id, who.id, shikona, JSON.stringify(placements), juryo && JSON.stringify(juryo),
    makushita && JSON.stringify(makushita), clientIp(request), submittedAt).run();
  return json({ basho: tournament.id, shikona, submitted_at: submittedAt });
}
