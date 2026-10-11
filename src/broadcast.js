// Test + mass emails to a project's users, with sent / opened tracking.
import { json, fail, cleanLine, normalizeEmail, validEmail } from './util.js';
import { renderEmail, renderSubject, escapeHtml } from './design.js';
import { loadDesign } from './flow.js';
import { sendGmail } from './public-api.js';
import { keys, runSql, ident } from './smart-client.js';

const BATCH = 15;
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
const maxRecipients = (env) => Number(env.BROADCAST_MAX_RECIPIENTS) || 500;
const dailyLimit = (env) => Number(env.BROADCAST_DAILY_LIMIT) || 400;

export function cleanContent(body) {
  let buttonUrl = '';
  if (body.buttonUrl) { try { const u = new URL(String(body.buttonUrl)); if (u.protocol === 'https:' || u.protocol === 'http:') buttonUrl = u.toString(); } catch (e) { /* ignore */ } }
  return {
    subject: cleanLine(body.subject, 200), heading: cleanLine(body.heading, 120),
    message: String(body.message ?? '').replace(/\r/g, '').slice(0, 5000),
    buttonText: cleanLine(body.buttonText, 40) || 'Open', buttonUrl,
  };
}

export async function recipientsFor(env, project, settings) {
  let rows;
  if (settings.storage.mode === 'external') throw { status: 400, message: 'Your users are stored on your own server (external gateway), so the platform has no list to send to.' };
  if (settings.storage.mode === 'smartbase') {
    const s = settings.storage.smartbase, k = await keys(env, project.id);
    if (!s.ready || !k.read || !s.mapping || !s.mapping.email) throw { status: 400, message: 'Smartbase storage needs an email column and a read key.' };
    const em = ident(s.mapping.email), nm = s.mapping.name ? ident(s.mapping.name) : null;
    const d = await runSql(env, k.read, s.databaseId, `SELECT ${em} AS email, ${nm ? nm : "''"} AS name FROM ${ident(s.table)} WHERE ${em} IS NOT NULL LIMIT 5000`);
    rows = d.rows || [];
  } else {
    rows = (await env.DB.prepare("SELECT email, name FROM end_users WHERE project_id = ? AND email != ''").bind(project.id).all()).results;
  }
  const out = new Map();
  for (const r of rows) { const e = normalizeEmail(r.email); if (validEmail(e) && !out.has(e)) out.set(e, cleanLine(r.name, 100)); }
  const optouts = new Set((await env.DB.prepare('SELECT email FROM broadcast_optouts WHERE project_id = ?').bind(project.id).all()).results.map((r) => r.email));
  return [...out].filter(([e]) => !optouts.has(e)).map(([email, name]) => ({ email, name }));
}

export async function buildHtml(env, project, content, who, origin, rid) {
  const { design } = await loadDesign(env, project);
  const d = { ...design, subject: content.subject, heading: content.heading || design.heading, message: content.message, buttonText: content.buttonText };
  const vars = { projectName: project.name, name: who.name || 'there', email: who.email, verificationUrl: content.buttonUrl || project.website || '#', logoUrl: design.logoDataUrl ? `${origin}/img/${project.id}/logo` : '', headerUrl: design.headerImageDataUrl ? `${origin}/img/${project.id}/header` : '' };
  let html = renderEmail(d, vars);
  const foot = rid
    ? `<div style="text-align:center;font:11px Arial,sans-serif;color:#9ca3af;padding:0 15px 25px">You received this email because you have an account with ${escapeHtml(project.name)}. <a href="${origin}/unsub/${rid}" style="color:#6b7280">Unsubscribe</a></div><img src="${origin}/o/${rid}.gif" width="1" height="1" alt="" style="display:none">`
    : '';
  html = html.includes('</body>') ? html.replace('</body>', foot + '</body>') : html + foot;
  return { html, subject: renderSubject(d, vars) || content.subject, fromName: design.companyName || project.name, replyTo: design.supportEmail || '' };
}

export async function sendTest(env, project, content, to, origin) {
  if (!validEmail(to)) throw { status: 400, message: 'Enter a valid email address.' };
  if (!content.subject) throw { status: 400, message: 'Subject is required.' };
  const m = await buildHtml(env, project, content, { email: to, name: 'there' }, origin, null);
  await sendGmail(env, to, '[TEST] ' + m.subject, m.html, m.fromName, m.replyTo);
}

export async function createBroadcast(env, project, settings, body) {
  const content = cleanContent(body);
  if (!content.subject || !content.message.trim()) throw { status: 400, message: 'Subject and message are required.' };
  const list = await recipientsFor(env, project, settings);
  if (!list.length) throw { status: 400, message: 'There are no users with an email address to send to yet.' };
  if (list.length > maxRecipients(env)) throw { status: 400, message: `This project has ${list.length} recipients; the limit per broadcast is ${maxRecipients(env)}.` };
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const stmts = [env.DB.prepare('INSERT INTO broadcasts (id, project_id, subject, content, status, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, project.id, content.subject, JSON.stringify(content), 'sending', list.length, now)];
  for (const r of list) stmts.push(env.DB.prepare("INSERT INTO broadcast_recipients (id, broadcast_id, email, name, status) VALUES (?, ?, ?, ?, 'pending')").bind(crypto.randomUUID().replace(/-/g, ''), id, r.email, r.name));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { id, total: list.length };
}

export async function progress(env, id) {
  const r = await env.DB.prepare(
    `SELECT b.id, b.subject, b.status, b.total, b.created_at,
       COALESCE(SUM(r.status = 'sent'), 0) AS sent, COALESCE(SUM(r.status = 'failed'), 0) AS failed,
       COALESCE(SUM(r.status = 'pending'), 0) AS pending, COALESCE(SUM(r.opened_at IS NOT NULL), 0) AS opened, COALESCE(SUM(r.open_count), 0) AS opens
     FROM broadcasts b LEFT JOIN broadcast_recipients r ON r.broadcast_id = b.id WHERE b.id = ? GROUP BY b.id`
  ).bind(id).first();
  return r ? { ...r, openRate: r.sent ? Math.round((r.opened / r.sent) * 1000) / 10 : 0 } : null;
}
export async function listBroadcasts(env, projectId) {
  const { results } = await env.DB.prepare('SELECT id FROM broadcasts WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').bind(projectId).all();
  const out = []; for (const r of results) out.push(await progress(env, r.id)); return out;
}

export async function sendBatch(env, project, broadcastId, origin) {
  const b = await env.DB.prepare('SELECT id, content, status FROM broadcasts WHERE id = ? AND project_id = ?').bind(broadcastId, project.id).first();
  if (!b) throw { status: 404, message: 'Broadcast not found.' };
  const since = new Date(Date.now() - 864e5).toISOString();
  const used = (await env.DB.prepare("SELECT COUNT(*) AS n FROM broadcast_recipients r JOIN broadcasts x ON x.id = r.broadcast_id WHERE x.project_id = ? AND r.sent_at > ?").bind(project.id, since).first()).n;
  const room = dailyLimit(env) - used;
  if (room <= 0) throw { status: 429, message: `Daily sending limit reached (${dailyLimit(env)} emails per 24 hours). Continue tomorrow.` };
  const { results } = await env.DB.prepare("SELECT id, email, name FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending' LIMIT ?").bind(b.id, Math.min(BATCH, room)).all();
  const content = JSON.parse(b.content);
  const optouts = new Set((await env.DB.prepare('SELECT email FROM broadcast_optouts WHERE project_id = ?').bind(project.id).all()).results.map((r) => r.email));
  for (const r of results) {
    const now = new Date().toISOString();
    if (optouts.has(r.email)) { await env.DB.prepare("UPDATE broadcast_recipients SET status = 'skipped' WHERE id = ?").bind(r.id).run(); continue; }
    try {
      const m = await buildHtml(env, project, content, r, origin, r.id);
      await sendGmail(env, r.email, m.subject, m.html, m.fromName, m.replyTo);
      await env.DB.prepare("UPDATE broadcast_recipients SET status = 'sent', sent_at = ? WHERE id = ?").bind(now, r.id).run();
    } catch (e) {
      await env.DB.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?").bind(String(e.message).slice(0, 200), r.id).run();
    }
  }
  const left = (await env.DB.prepare("SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'").bind(b.id).first()).n;
  if (!left) await env.DB.prepare("UPDATE broadcasts SET status = 'done' WHERE id = ?").bind(b.id).run();
  return await progress(env, b.id);
}

export async function handleOpenPixel(env, url) {
  const rid = url.pathname.replace(/^\/o\//, '').replace(/\.gif$/, '');
  if (/^[0-9a-f]{32}$/.test(rid)) {
    await env.DB.prepare("UPDATE broadcast_recipients SET open_count = open_count + 1, opened_at = COALESCE(opened_at, ?) WHERE id = ? AND status = 'sent'").bind(new Date().toISOString(), rid).run();
  }
  return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' } });
}

const page = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="font-family:Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;text-align:center;color:#1f2937"><h2>${escapeHtml(title)}</h2>${body}</body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
export async function handleUnsubscribe(request, env, url) {
  const rid = url.pathname.replace(/^\/unsub\//, '');
  if (!/^[0-9a-f]{32}$/.test(rid)) return page('Link not valid', '<p>This unsubscribe link is not valid.</p>');
  const row = await env.DB.prepare('SELECT r.email, b.project_id, p.name FROM broadcast_recipients r JOIN broadcasts b ON b.id = r.broadcast_id JOIN projects p ON p.id = b.project_id WHERE r.id = ?').bind(rid).first();
  if (!row) return page('Link not valid', '<p>This unsubscribe link is not valid.</p>');
  if (request.method === 'POST') {
    await env.DB.prepare('INSERT OR IGNORE INTO broadcast_optouts (project_id, email, created_at) VALUES (?, ?, ?)').bind(row.project_id, row.email, new Date().toISOString()).run();
    return page('You are unsubscribed', `<p>${escapeHtml(row.email)} will no longer receive broadcast emails from ${escapeHtml(row.name)}.</p>`);
  }
  return page('Unsubscribe?', `<p>Stop receiving broadcast emails from ${escapeHtml(row.name)} at ${escapeHtml(row.email)}?</p><form method="post"><button style="padding:12px 22px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:16px;cursor:pointer">Unsubscribe</button></form>`);
}
