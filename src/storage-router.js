// Sends a signed-in user to the place the developer chose: Smartbase database (platform storage) or an external gateway.
import { randomHex } from './util.js';
import { encryptSecret, decryptSecret } from './google-creds.js';
import { getSecret } from './settings.js';
import { keys, runSql, buildUserSql, TEMPLATE_DEVICES } from './smart-client.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sign(secret, timestamp, body) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + hex(await crypto.subtle.sign('HMAC', k, enc.encode(timestamp + '.' + body)));
}
export function validExternalUrl(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch (e) { return ''; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password) return '';
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':') || !h.includes('.')) return '';
  return u.toString();
}

async function sendExternal(env, projectId, settings, event) {
  const secret = await getSecret(env, projectId, 'gateway');
  if (!settings.storage.external.url || !secret) throw new Error('External gateway is not configured.');
  const body = JSON.stringify(event), ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(settings.storage.external.url, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(6000),
    headers: { 'Content-Type': 'application/json', 'X-Smartbase-Event-Id': event.id, 'X-Smartbase-Timestamp': ts, 'X-Smartbase-Signature': await sign(secret, ts, body) },
    body,
  });
  if (res.status < 200 || res.status >= 300) throw new Error('Your server answered with status ' + res.status);
}
async function sendSmartbase(env, projectId, settings, job) {
  const k = await keys(env, projectId);
  if (!k.write) throw new Error('Smartbase write key is missing.');
  await runSql(env, k.write, settings.storage.smartbase.databaseId, job.sql);
}
async function queue(env, projectId, kind, payload, error) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO gateway_events (id, project_id, kind, payload_enc, status, attempts, last_error, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, projectId, kind, await encryptSecret(env, JSON.stringify(payload), id), 'failed', String(error).slice(0, 200), new Date().toISOString()).run();
  return id;
}

/** ev: { profile, endUserId, deviceHash, isNew } -> { ok, queued } (never throws; failures are queued for retry) */
export async function deliverUser(env, project, settings, ev) {
  const mode = settings.storage.mode, at = new Date().toISOString();
  if (mode !== 'smartbase' && mode !== 'external') return { ok: true };
  const values = { id: ev.endUserId, provider: 'google', provider_user_id: ev.profile.sub, email: ev.profile.email, email_verified: ev.profile.emailVerified ? 1 : 0, name: ev.profile.name, picture: ev.profile.picture, created_at: at, last_login_at: at };
  try {
    if (mode === 'smartbase') {
      const s = settings.storage.smartbase; if (!s.ready) throw new Error('Smartbase storage is not ready.');
      const devices = settings.accountControl.enabled && ev.deviceHash && s.devicesTable ? { table: s.devicesTable, deviceHash: ev.deviceHash, at } : null;
      const job = { sql: buildUserSql({ table: s.table, mapping: s.mapping, extra: s.extra, keyField: s.keyField, values, devices }) };
      try { await sendSmartbase(env, project.id, settings, job); return { ok: true }; } catch (e) { return { ok: false, queued: await queue(env, project.id, 'smartbase', job, e.message) }; }
    }
    const event = { id: crypto.randomUUID(), type: ev.isNew ? 'user.created' : 'user.signed_in', project_id: project.id, created_at: at, user: { id: ev.endUserId, provider: 'google', provider_user_id: ev.profile.sub, email: ev.profile.email, email_verified: !!ev.profile.emailVerified, name: ev.profile.name, picture: ev.profile.picture }, device: ev.deviceHash ? { hash: ev.deviceHash } : null };
    try { await sendExternal(env, project.id, settings, event); return { ok: true }; } catch (e) { return { ok: false, queued: await queue(env, project.id, 'external', event, e.message) }; }
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function sendTestEvent(env, project, settings) {
  await sendExternal(env, project.id, settings, { id: crypto.randomUUID(), type: 'ping', project_id: project.id, created_at: new Date().toISOString() });
}
export async function retryEvents(env, project, settings, limit = 10) {
  const { results } = await env.DB.prepare("SELECT id, kind, payload_enc FROM gateway_events WHERE project_id = ? AND status != 'sent' ORDER BY created_at LIMIT ?").bind(project.id, limit).all();
  let sent = 0, failed = 0;
  for (const r of results) {
    try {
      const payload = JSON.parse(await decryptSecret(env, r.payload_enc, r.id));
      if (r.kind === 'smartbase') await sendSmartbase(env, project.id, settings, payload); else await sendExternal(env, project.id, settings, payload);
      await env.DB.prepare("DELETE FROM gateway_events WHERE id = ?").bind(r.id).run(); sent++;
    } catch (e) {
      await env.DB.prepare('UPDATE gateway_events SET attempts = attempts + 1, last_error = ? WHERE id = ?').bind(String(e.message).slice(0, 200), r.id).run(); failed++;
    }
  }
  return { sent, failed };
}
export const newGatewaySecret = () => 'whsec_' + randomHex(24);
export { TEMPLATE_DEVICES };
