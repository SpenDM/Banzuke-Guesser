// GET /api/me?basho=YYYYMM  with X-Guesser-Token and/or Authorization: Bearer <ID token>.
// The caller's profile: { shikona, signed_in, provider, submission } — `submission` being their
// prediction for the round `basho` ({placements, submitted_at}) or null.
import { error, identify, json, profile } from '../_shared.js';

export async function onRequestGet({ request, env }) {
  const who = await identify(request, env);
  if (who.error) return error(who.error, who.error === 'bad_auth' ? 401 : 400);
  return json(await profile(env.DB, who, new URL(request.url).searchParams.get('basho')));
}
