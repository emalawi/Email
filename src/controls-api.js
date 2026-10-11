// Dashboard API for: sign-in domain, user storage (Smartbase / external gateway), account control, broadcasts, database copy.
import { json, fail, cleanLine, sha256Hex, validEmail, normalizeEmail } from './util.js';
import { getDeveloper } from './session.js';
import { getSettings, saveSettings, setSecret, getSecret, deleteSecret } from './settings.js';
import { smartUrl, keys, probeKey, listDatabases, runSql, ident, tableColumns, STANDARD_FIELDS, TEMPLATE_SQL, TEMPLATE_USERS, TEMPLATE_DEVICES, IDENTITY_MAP } from './smart-client.js';
import { validHost, snippets, verifyDomain, PREFIX } from './domain.js';
import { validExternalUrl, sendTestEvent, retryEvents, newGatewaySecret } from './storage-router.js';
import { getStats } from './account-control.js';
import { recipientsFor, createBroadcast, sendBatch, sendTest, listBroadcasts, progress, cleanContent } from './broadcast.js';
import { collectTables, viewerHtml } from './db-copy.js';

const bad = (message, status = 400) => { throw { status, message }; };
const keyOk = (k) => typeof k === 'string' && /^[\x21-\x7e]{16,200}$/.test(k.trim());

async function ownedProject(env, developer, projectId) {
  return await env.DB.prepare('SELECT id, name, website, google_enabled, google_client_id, google_client_secret_enc FROM projects WHERE id = ? AND user_id = ?')
    .bind(String(projectId ?? ''), developer.id).first();
}
const hasOwnGoogleApp = (p) => !!(p.google_client_id && p.google_client_secret_enc);

async function summary(env, project, settings, url) {
  const k = await keys(env, project.id), s = settings.storage;
  return {
    success: true, projectId: project.id,
    google: { custom: hasOwnGoogleApp(project), clientId: hasOwnGoogleApp(project) ? project.google_client_id : '' },
    defaultCallback: `${url.origin}/auth/google/callback`,
    domain: { ...settings.domain, snippets: settings.domain.host ? snippets(settings.domain.host, url.origin) : null },
    storage: {
      mode: s.mode, smartbaseUrl: smartUrl(env),
      smartbase: { connected: !!(k.read && k.write), hasRead: !!k.read, hasWrite: !!k.write, ...s.smartbase },
      external: { url: s.external.url, configured: s.external.configured },
    },
    accountControl: settings.accountControl,
    standardFields: STANDARD_FIELDS,
    sdkUrl: `${url.origin}/smartbase-data.js`,
  };
}

async function smartKeys(env, project) {
  const k = await keys(env, project.id);
  if (!k.read || !k.write) bad('Connect your Smartbase read and write keys first.');
  return k;
}

export async function handleControlsApi(request, env, url) {
  const path = url.pathname, m = request.method;
  if (m !== 'GET') { const o = request.headers.get('Origin'); if (o && o !== url.origin) return fail('Bad origin.', 403); }
  const developer = await getDeveloper(request, env);
  if (!developer) return fail('Please log in.', 401);
  try {
    const body = m === 'GET' ? {} : (await request.json().catch(() => null)) || {};
    const project = await ownedProject(env, developer, m === 'GET' ? url.searchParams.get('projectId') : body.projectId);
    if (!project) return fail('Project not found.', 404);
    const settings = await getSettings(env, project.id);
    const save = () => saveSettings(env, project.id, settings);

    if (path === '/api/controls' && m === 'GET') return json(await summary(env, project, settings, url));

    /* ---- 1. sign-in domain ---- */
    if (path === '/api/controls/domain' && m === 'PUT') {
      if (body.mode === 'default') { settings.domain = { mode: 'default', host: '', verifiedAt: null }; await save(); return json(await summary(env, project, settings, url)); }
      if (body.mode !== 'custom') bad('Unknown mode.');
      if (!hasOwnGoogleApp(project)) bad('A custom domain needs your own Google app. Add your Google Client ID and Secret first.');
      const host = validHost(body.host);
      if (!host) bad('Enter your domain without https://, for example dance.com or login.dance.com.');
      settings.domain = { mode: 'custom', host, verifiedAt: null }; await save();
      return json(await summary(env, project, settings, url));
    }
    if (path === '/api/controls/domain/verify' && m === 'POST') {
      if (settings.domain.mode !== 'custom' || !settings.domain.host) bad('Choose a custom domain first.');
      if (!(await verifyDomain(settings.domain.host))) return json({ success: false, verified: false, message: `We could not reach this platform through https://${settings.domain.host}${PREFIX}/api/ping. Check the forwarding rule and try again.` });
      settings.domain.verifiedAt = new Date().toISOString(); await save();
      return json({ success: true, verified: true, ...(await summary(env, project, settings, url)) });
    }

    /* ---- 2. user storage ---- */
    if (path === '/api/controls/smart/connect' && m === 'POST') {
      const w = String(body.writeKey || '').trim(), r = String(body.readKey || '').trim();
      if (!keyOk(w) || !keyOk(r)) bad('Paste both the write key and the read key from your Smartbase API Center.');
      if ((await probeKey(env, w)) !== 'write') bad('The write key was not accepted (it must be a write key).');
      if ((await probeKey(env, r)) !== 'read') bad('The read key was not accepted (it must be a read key).');
      await setSecret(env, project.id, 'smart_write', w); await setSecret(env, project.id, 'smart_read', r);
      settings.storage.smartbase.connected = true; await save();
      return json({ success: true, databases: (await listDatabases(env, r)).map((d) => ({ id: d.id, name: d.name })) });
    }
    if (path === '/api/controls/smart/databases' && m === 'GET') {
      const k = await smartKeys(env, project);
      return json({ success: true, databases: (await listDatabases(env, k.read)).map((d) => ({ id: d.id, name: d.name })) });
    }
    if (path === '/api/controls/smart/disconnect' && m === 'POST') {
      await deleteSecret(env, project.id, 'smart_read'); await deleteSecret(env, project.id, 'smart_write');
      settings.storage.smartbase = { ...settings.storage.smartbase, connected: false, ready: false };
      if (settings.storage.mode === 'smartbase') settings.storage.mode = 'default';
      await save(); return json(await summary(env, project, settings, url));
    }
    if (path === '/api/controls/smart/use-database' && m === 'POST') {
      const k = await smartKeys(env, project), db = (await listDatabases(env, k.read)).find((d) => d.id === body.databaseId);
      if (!db) bad('That database was not found in your Smartbase account.', 404);
      const sb = settings.storage.smartbase;
      if (body.kind === 'custom') {
        Object.assign(sb, { databaseId: db.id, databaseName: db.name, kind: 'custom', table: body.table ? ident(body.table) : '', mapping: null, extra: {}, devicesTable: '', ready: false, structureAt: null });
      } else {
        const existing = ((await runSql(env, k.read, db.id, 'SHOW TABLES')).rows || []).map((r) => r.Tables);
        if (existing.some((t) => t !== TEMPLATE_USERS && t !== TEMPLATE_DEVICES)) bad('This database already has tables. Pick an empty database for the template, or choose "Custom database".');
        await runSql(env, k.write, db.id, TEMPLATE_SQL);
        Object.assign(sb, { databaseId: db.id, databaseName: db.name, kind: 'template', table: TEMPLATE_USERS, mapping: IDENTITY_MAP, extra: {}, keyField: 'provider_user_id', devicesTable: TEMPLATE_DEVICES, ready: true, structureAt: new Date().toISOString() });
      }
      await save(); return json(await summary(env, project, settings, url));
    }
    if (path === '/api/controls/smart/custom-sql' && m === 'POST') {
      const k = await smartKeys(env, project), sb = settings.storage.smartbase, sql = String(body.sql || '');
      if (!sb.databaseId) bad('Choose a database first.');
      if (!sql.trim() || sql.length > 20000) bad('Enter SQL (max 20,000 characters).');
      const d = await runSql(env, k.write, sb.databaseId, sql);
      return json({ success: true, message: d.message || 'Done', results: (d.results || []).length });
    }
    if (path === '/api/controls/storage' && m === 'PUT') {
      const mode = body.mode, s = settings.storage;
      if (!['default', 'smartbase', 'external'].includes(mode)) bad('Unknown storage mode.');
      if (mode === 'smartbase' && !s.smartbase.ready) bad(s.smartbase.kind === 'custom' && s.smartbase.databaseId ? 'Waiting for your SDK: call SmartbaseData.defineStructure(...) from your server first.' : 'Connect and choose a Smartbase database first.');
      if (mode === 'external' && !s.external.configured) bad('Set your gateway URL first.');
      s.mode = mode; await save(); return json(await summary(env, project, settings, url));
    }
    if (path === '/api/controls/external' && m === 'POST') {
      const u = validExternalUrl(body.url);
      if (!u) bad('Enter a public https:// address (not localhost or an IP address).');
      const secret = newGatewaySecret();
      await setSecret(env, project.id, 'gateway', secret);
      settings.storage.external = { url: u, configured: true }; await save();
      return json({ ...(await summary(env, project, settings, url)), signingSecret: secret });
    }
    if (path === '/api/controls/external/test' && m === 'POST') {
      try { await sendTestEvent(env, project, settings); } catch (e) { return json({ success: false, message: 'Your server did not accept the test: ' + e.message }); }
      return json({ success: true, message: 'Test event delivered.' });
    }
    if (path === '/api/controls/events' && m === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, kind, status, attempts, last_error, created_at FROM gateway_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').bind(project.id).all();
      return json({ success: true, events: results });
    }
    if (path === '/api/controls/events/retry' && m === 'POST') return json({ success: true, ...(await retryEvents(env, project, settings)) });

    /* ---- 3. account control ---- */
    if (path === '/api/controls/account' && m === 'PUT') {
      if (!['monitor', 'enforce'].includes(body.mode)) bad('Choose monitor or enforce.');
      settings.accountControl = { enabled: body.enabled === true, mode: body.mode }; await save();
      return json(await summary(env, project, settings, url));
    }
    if (path === '/api/controls/account-stats' && m === 'GET') return json({ success: true, stats: await getStats(env, project.id, settings) });

    /* ---- 4. database copy + broadcasts ---- */
    if (path === '/api/db-copy' && m === 'GET') {
      const tables = await collectTables(env, project, settings);
      const html = viewerHtml(project.name + ' database copy', tables);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${project.name.replace(/[^\w.-]+/g, '_')}-database-copy.html"`, 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/broadcasts' && m === 'GET') {
      let audience = null; try { audience = (await recipientsFor(env, project, settings)).length; } catch (e) { audience = null; }
      return json({ success: true, audience, broadcasts: await listBroadcasts(env, project.id) });
    }
    if (path === '/api/broadcasts/test' && m === 'POST') {
      const to = normalizeEmail(body.to || developer.email);
      await sendTest(env, project, cleanContent(body), to, url.origin);
      return json({ success: true, message: 'Test email sent to ' + to });
    }
    if (path === '/api/broadcasts' && m === 'POST') return json({ success: true, ...(await createBroadcast(env, project, settings, body)) }, 201);
    if (path === '/api/broadcasts/send' && m === 'POST') return json({ success: true, progress: await sendBatch(env, project, String(body.broadcastId || ''), url.origin) });
    if (path === '/api/broadcasts/status' && m === 'GET') {
      const p = await progress(env, String(url.searchParams.get('id') || ''));
      return p ? json({ success: true, progress: p }) : fail('Broadcast not found.', 404);
    }
    return fail('Not found.', 404);
  } catch (e) {
    if (e && e.status) return fail(e.message, e.status);
    console.error(e && e.message);
    return fail('Something went wrong. Please try again.', 500);
  }
}

/** Public, secret-key API: the developer's SDK declares how user data is written to their own table. */
export async function handleStructureApi(request, env, url) {
  const key = request.headers.get('X-Smartbase-Key') || '';
  if (!/^sb_live_[0-9a-f]{48}$/.test(key)) return fail('Invalid or missing API key.', 401);
  const project = await env.DB.prepare('SELECT p.id FROM api_keys k JOIN projects p ON p.id = k.project_id WHERE k.key_hash = ? AND k.active = 1').bind(await sha256Hex(key)).first();
  if (!project) return fail('Invalid or missing API key.', 401);
  const settings = await getSettings(env, project.id), sb = settings.storage.smartbase;
  if (request.method === 'GET') return json({ success: true, ready: sb.ready, kind: sb.kind, table: sb.table, fields: sb.mapping, extra: sb.extra, keyField: sb.keyField });
  if (request.method !== 'POST') return fail('Method not allowed.', 405);
  try {
    if (!sb.databaseId || sb.kind !== 'custom') bad('Choose "Custom database" in the dashboard first.');
    const body = await request.json().catch(() => null) || {};
    const table = ident(body.table), fields = {}, extra = {};
    for (const [f, c] of Object.entries(body.fields || {})) { if (!STANDARD_FIELDS.includes(f)) bad(`Unknown field "${f}". Allowed: ${STANDARD_FIELDS.join(', ')}.`); fields[f] = ident(c); }
    if (!fields.email && !fields.provider_user_id) bad('Map at least "email" or "provider_user_id".');
    for (const [c, v] of Object.entries(body.extra || {})) { if (v !== null && !['string', 'number'].includes(typeof v)) bad('extra values must be text, number or null.'); extra[ident(c)] = typeof v === 'string' ? v.slice(0, 200) : v; }
    const keyField = body.keyField || (fields.provider_user_id ? 'provider_user_id' : 'email');
    if (!fields[keyField]) bad('keyField must be one of the mapped fields.');
    const k = await keys(env, project.id); if (!k.read || !k.write) bad('Connect your Smartbase keys in the dashboard first.');
    let cols; try { cols = await tableColumns(env, k.read, sb.databaseId, table); } catch (e) { bad(`Table "${table}" was not found in the selected database.`, 404); }
    const missing = [...Object.values(fields), ...Object.keys(extra)].filter((c) => !cols.includes(c.toLowerCase()));
    if (missing.length) return json({ success: false, error: 'Columns not found', message: 'These columns do not exist in the table: ' + missing.join(', '), missing }, 400);
    Object.assign(sb, { table, mapping: fields, extra, keyField, devicesTable: '', ready: true, structureAt: new Date().toISOString() });
    await saveSettings(env, project.id, settings);
    return json({ success: true, ready: true, table, fields, extra, keyField });
  } catch (e) { return e && e.status ? fail(e.message, e.status) : fail('Could not save the structure.', 500); }
}
