import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { resetKeyCache, verifyIdToken } from '../../functions/firebase.js';

globalThis.crypto ??= webcrypto;   // Node 16 has no global WebCrypto; Workers do

const PROJECT = 'banzuke-test';
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encode = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

const generate = () => crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
// The harness collects tests synchronously, so the key pair is made lazily, inside the tests.
let privateKey;
let jwk;
const setup = (async () => {
  const pair = await generate();
  privateKey = pair.privateKey;
  jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', use: 'sig', alg: 'RS256' };
  delete jwk.key_ops; delete jwk.ext;
})();

// Google's JWKS endpoint, answering with our key; counts the fetches to check the cache.
let fetches = 0;
const fetchImpl = async () => {
  fetches++;
  return { ok: true, headers: { get: () => 'public, max-age=3600' }, json: async () => ({ keys: [jwk] }) };
};

const t = Math.floor(NOW / 1000);
const claims = (over = {}) => ({
  iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'uid-123', iat: t - 60, exp: t + 3600,
  auth_time: t - 60, email: 'a@b.c', firebase: { sign_in_provider: 'google.com' }, ...over,
});
async function token(payload, { header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }, key } = {}) {
  await setup;
  key ||= privateKey;
  const body = `${encode(header)}.${encode(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}
const verify = (tok, now = NOW) => verifyIdToken(tok, PROJECT, { fetchImpl, now });

test('a token signed by a Google key with the right claims verifies', async () => {
  resetKeyCache();
  assert.deepEqual(await verify(await token(claims())), { uid: 'uid-123', email: 'a@b.c', provider: 'google.com' });
  assert.equal(fetches, 1);
  await verify(await token(claims()));
  assert.equal(fetches, 1, 'keys are cached for max-age');
  await verify(await token(claims()), NOW + 3601 * 1000 - 1);   // fetch again after max-age; token is expired by then though
  assert.equal(fetches, 2);
});

test('a tampered or foreign signature is rejected', async () => {
  const other = await generate();
  assert.equal(await verify(await token(claims(), { key: other.privateKey })), null);
  const good = await token(claims());
  const [h, , sig] = good.split('.');
  assert.equal(await verify(`${h}.${encode(claims({ sub: 'someone-else' }))}.${sig}`), null);
  assert.equal(await verify(`${h}.${encode(claims())}.${sig.slice(0, -2)}AA`), null);
});

test('claims are checked: exp, iat, aud, iss, sub, alg, kid', async () => {
  assert.equal(await verify(await token(claims({ exp: t - 1 }))), null);
  assert.equal(await verify(await token(claims({ iat: t + 120 }))), null);
  assert.equal(await verify(await token(claims({ iat: t + 30 }))) !== null, true, 'a minute of clock skew is tolerated');
  assert.equal(await verify(await token(claims({ aud: 'other-project' }))), null);
  assert.equal(await verify(await token(claims({ iss: 'https://securetoken.google.com/other-project' }))), null);
  assert.equal(await verify(await token(claims({ sub: '' }))), null);
  assert.equal(await verify(await token(claims(), { header: { alg: 'none', kid: 'k1' } })), null);
  assert.equal(await verify(await token(claims(), { header: { alg: 'RS256', kid: 'unknown' } })), null);
  assert.equal(await verify('not.a.jwt'), null);
  assert.equal(await verify('garbage'), null);
  assert.equal(await verifyIdToken(await token(claims()), '', { fetchImpl, now: NOW }), null, 'no project id: sign-in disabled');
});
