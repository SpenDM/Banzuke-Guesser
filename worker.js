// Worker entry point: routes /api/* to the handlers in functions/api (which keep the Pages
// Functions calling convention, `handler({ request, env })`) and everything else to the static
// assets in public/.
import { onRequestPost as submit } from './functions/api/submit.js';
import { onRequestGet as submissions } from './functions/api/submissions.js';

const ROUTES = {
  '/api/submit': { POST: submit },
  '/api/submissions': { GET: submissions },
};

export default {
  async fetch(request, env, ctx) {
    const route = ROUTES[new URL(request.url).pathname];
    if (route) {
      const handler = route[request.method];
      if (!handler) return new Response('Method not allowed', { status: 405, headers: { allow: Object.keys(route).join(', ') } });
      return handler({ request, env, ctx });
    }
    return env.ASSETS.fetch(request);
  },
};
