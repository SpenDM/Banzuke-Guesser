// Worker entry point: routes /api/* to the handlers in functions/api (which keep the Pages
// Functions calling convention, `handler({ request, env })`), /__/auth/* to Firebase's sign-in
// helper, and everything else to the static assets in public/.
import { onRequestPost as submit } from './functions/api/submit.js';
import { onRequestGet as submissions } from './functions/api/submissions.js';
import { onRequestPost as register } from './functions/api/register.js';
import { onRequestGet as me } from './functions/api/me.js';
import { firebaseConfig } from './public/js/firebase-config.js';

const ROUTES = {
  '/api/submit': { POST: submit },
  '/api/submissions': { GET: submissions },
  '/api/register': { POST: register },
  '/api/me': { GET: me },
};

/**
 * Firebase Auth's sign-in helper pages, served from this domain (firebaseConfig.authDomain) by
 * proxying them to <projectId>.firebaseapp.com, so the Google popup/redirect keeps working in
 * browsers that block third-party storage:
 * https://firebase.google.com/docs/auth/web/redirect-best-practices#proxy-requests
 */
function firebaseAuthHelper(request, url) {
  if (!firebaseConfig.projectId) return new Response('Not found', { status: 404 });
  const upstream = new URL(url);
  upstream.protocol = 'https:';
  upstream.host = `${firebaseConfig.projectId}.firebaseapp.com`;
  return fetch(new Request(upstream, request));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__/auth/')) return firebaseAuthHelper(request, url);
    const route = ROUTES[url.pathname];
    if (route) {
      const handler = route[request.method];
      if (!handler) return new Response('Method not allowed', { status: 405, headers: { allow: Object.keys(route).join(', ') } });
      return handler({ request, env, ctx });
    }
    return env.ASSETS.fetch(request);
  },
};
