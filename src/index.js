import { json, fail } from './util.js';
import { handleDashboardApi } from './dashboard.js';
import { handlePublicApi, handleVerify, handleImage } from './public-api.js';
import { handleTestApi } from './test-email.js';
import { handleFlowApi } from './flow.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
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
