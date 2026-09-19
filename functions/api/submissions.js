// GET /api/submissions?basho=YYYYMM  (optional X-Guesser-Token / Authorization: Bearer <ID token>)
// The caller's own submission for the round plus, once that basho's banzuke is published so nobody
// can crib from the others beforehand, everyone's shikona and placements for the leaderboard.
import { banzukePublished, error, identify, json } from '../_shared.js';

const row = (r) => r && { shikona: r.shikona, placements: JSON.parse(r.placements), submitted_at: r.submitted_at };

export async function onRequestGet({ request, env }) {
  const basho = new URL(request.url).searchParams.get('basho') || '';
  if (!/^\d{6}$/.test(basho)) return error('unknown_basho', 400);
  const who = await identify(request, env);
  if (who.error === 'bad_auth') return error('bad_auth', 401);

  const [published, me, count] = await Promise.all([
    banzukePublished(env, request, basho),
    who.id
      ? env.DB.prepare('SELECT shikona, placements, submitted_at FROM submissions WHERE basho_id = ?1 AND user_id = ?2')
        .bind(basho, who.id).first()
      : null,
    env.DB.prepare('SELECT COUNT(*) AS n FROM submissions WHERE basho_id = ?1').bind(basho).first('n'),
  ]);
  const out = { basho, published, count: count || 0, me: row(me) };
  if (published) {
    const { results } = await env.DB.prepare(
      'SELECT shikona, placements, submitted_at FROM submissions WHERE basho_id = ?1 ORDER BY submitted_at',
    ).bind(basho).all();
    out.submissions = results.map(row);
  }
  return json(out);
}
