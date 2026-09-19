// Verifies Firebase ID tokens with WebCrypto, following
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
// firebase-admin does not run on Workers and this keeps the Worker dependency-free. Google's
// signing keys come from its JWKS endpoint and are cached in the isolate for the response's max-age.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const IAT_LEEWAY = 60;   // seconds of clock skew tolerated on iat/auth_time

let cached = { keys: null, expires: 0 };

/** Google's current signing keys by kid. `fetchImpl` and `now` (ms) are injectable for tests. */
export async function signingKeys(fetchImpl = fetch, now = Date.now()) {
  if (!cached.keys || now >= cached.expires) {
    const res = await fetchImpl(JWKS_URL);
    if (!res.ok) throw new Error(`JWKS: HTTP ${res.status}`);
    const { keys } = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
    cached = { keys: new Map(keys.map((k) => [k.kid, k])), expires: now + maxAge * 1000 };
  }
  return cached.keys;
}

function base64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const decodeJson = (part) => JSON.parse(new TextDecoder().decode(base64url(part)));

/**
 * The claims of a valid ID token issued for `projectId` — { uid, email, provider } — or null when
 * the token is malformed, mis-signed, expired or for another project. Throws only when the signing
 * keys cannot be fetched.
 */
export async function verifyIdToken(idToken, projectId, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!projectId || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const jwk = (await signingKeys(fetchImpl, now)).get(header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let ok;
  try {
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64url(parts[2]), signed);
  } catch {
    return null;
  }
  if (!ok) return null;

  const t = Math.floor(now / 1000);
  const { exp, iat, auth_time: authTime, aud, iss, sub } = payload;
  if (!(typeof exp === 'number' && exp > t)) return null;
  if (!(typeof iat === 'number' && iat <= t + IAT_LEEWAY)) return null;
  if (!(typeof authTime === 'number' && authTime <= t + IAT_LEEWAY)) return null;
  if (aud !== projectId || iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof sub !== 'string' || !sub || sub.length > 128) return null;
  return { uid: sub, email: payload.email || null, provider: payload.firebase?.sign_in_provider || null };
}

/** Clears the key cache (tests). */
export function resetKeyCache() { cached = { keys: null, expires: 0 }; }
