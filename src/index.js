export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      try {
        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'"
        ).first();
        return Response.json({
          success: true,
          platform: 'Smartbase Email Platform',
          status: 'running',
          tables: row.tables,
        });
      } catch (err) {
        return Response.json({ success: false, error: err.message }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
