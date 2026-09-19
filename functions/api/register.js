// POST /api/register  { shikona?, basho? }  with X-Guesser-Token and/or Authorization: Bearer <ID token>.
// Registers (or renames) the caller under `shikona`; without one it just answers with the profile,
// which is how the page syncs after signing in or out (the sign-in itself is handled by Firebase;
// identify() folds the browser's anonymous identity into the account). A shikona belongs to one
// user across every round (→ 409 shikona_taken). `basho` asks for the caller's submission for
// that round as well, like /api/me.
import { error, identify, json, profile, validateShikona } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const who = await identify(request, env);
  if (who.error) return error(who.error, who.error === 'bad_auth' ? 401 : 400);
  let body;
  try { body = await request.json(); } catch { return error('bad_json', 400); }

  if (body.shikona !== undefined) {
    const shikona = validateShikona(body.shikona);
    if (!shikona) return error('bad_shikona', 400);
    const taken = await env.DB.prepare(
      'SELECT user_id FROM users WHERE shikona = ?1 COLLATE NOCASE AND user_id <> ?2',
    ).bind(shikona, who.id).first();
    if (taken) return error('shikona_taken', 409);
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO users (user_id, shikona, provider, registered_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?4)
          ON CONFLICT (user_id) DO UPDATE SET
            shikona = excluded.shikona, provider = excluded.provider, updated_at = excluded.updated_at`,
        ).bind(who.id, shikona, who.account?.provider ?? null, now),
        env.DB.prepare('UPDATE submissions SET shikona = ?2 WHERE user_id = ?1').bind(who.id, shikona),
      ]);
    } catch (e) {
      // Two users racing for the same shikona: the UNIQUE index catches what the SELECT above missed.
      if (/UNIQUE/i.test(String(e))) return error('shikona_taken', 409);
      throw e;
    }
  }
  return json(await profile(env.DB, who, body.basho));
}
