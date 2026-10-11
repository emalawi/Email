import { json, fail } from './util.js';
import { handleDashboardApi } from './dashboard.js';
import { handlePublicApi, handleVerify, handleImage } from './public-api.js';
import { handleTestApi } from './test-email.js';
import { handleFlowApi } from './flow.js';
import { handleGoogleAuth, handleGoogleExchange, handleProviderApi } from './google-auth.js';
import { handleGoogleTest } from './google-test.js';
import { handleSigninApi, brandGoogleRedirect } from './signin-page.js';
import { handleControlsApi, handleStructureApi } from './controls-api.js';
import { handleOpenPixel, handleUnsubscribe } from './broadcast.js';
import { PREFIX } from './domain.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // A developer's custom sign-in domain forwards https://their-domain/__smartbase/* to this platform.
    if (url.pathname.startsWith(PREFIX + '/')) {
      url.sbPrefix = PREFIX;
      url.pathname = url.pathname.slice(PREFIX.length);
    }
    const path = url.pathname;

    try {
      if (path === '/api/ping') return json({ success: true, platform: 'smartbase-email' });
      if (path.startsWith('/o/') && request.method === 'GET') return await handleOpenPixel(env, url);
      if (path.startsWith('/unsub/') && (request.method === 'GET' || request.method === 'POST')) return await handleUnsubscribe(request, env, url);
      if (path === '/api/v1/storage/structure') return await handleStructureApi(request, env, url);
      if (path.startsWith('/api/controls') || path.startsWith('/api/broadcasts') || path === '/api/db-copy') {
        return await handleControlsApi(request, env, url);
      }
      if (path === '/api/health') {
        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'"
        ).first();
        return json({
          success: true,
          platform: 'Smartbase Email Platform',
          status: 'running',
          tables: row.tables,
        });
      }

      if (path.startsWith('/verify/') && request.method === 'GET') {
        return await handleVerify(request, env, url);
      }
      if (path.startsWith('/img/') && request.method === 'GET') {
        return await handleImage(request, env, url);
      }

      if (path === '/auth/google/start' || path === '/auth/google/test-start') {
        const original =
          path === '/auth/google/start'
            ? await handleGoogleAuth(request, env, url)
            : await handleGoogleTest(request, env, url);
        return await brandGoogleRedirect(original, env, url);
      }
      if (path === '/api/google-test-result') {
        return await handleGoogleTest(request, env, url);
      }
      if (path.startsWith('/auth/google/')) {
        return await handleGoogleAuth(request, env, url);
      }
      if (path === '/api/v1/google/exchange') {
        return await handleGoogleExchange(request, env);
      }
      if (path === '/api/providers' || path === '/api/end-users') {
        return await handleProviderApi(request, env, url);
      }
      if (path === '/api/signin-page' || path === '/api/signin-preview') {
        return await handleSigninApi(request, env, url);
      }
      if (path === '/preview/success' || path === '/api/flow') {
        return await handleFlowApi(request, env, url);
      }
      if (path.startsWith('/api/test-')) {
        return await handleTestApi(request, env, url);
      }
      if (path.startsWith('/api/v1/')) {
        return await handlePublicApi(request, env, url);
      }
      if (path.startsWith('/api/')) {
        return await handleDashboardApi(request, env, url);
      }
    } catch (err) {
      console.error(err);
      return fail('Server error.', 500);
    }

    return env.ASSETS.fetch(request);
  },
};
