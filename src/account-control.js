// "One account, one device". Monitor = count only. Enforce = a device may only ever sign in to one account.
import { sha256Hex } from './util.js';

export const validDeviceId = (d) => /^[A-Za-z0-9_-]{16,64}$/.test(String(d || ''));
export const deviceHashFor = (projectId, deviceId) => sha256Hex(projectId + ':' + deviceId);

/** Decide whether this device may sign in to this account. endUserId is null for a brand-new account. */
export async function checkDevice(env, projectId, deviceHash, endUserId, mode) {
  if (mode !== 'enforce') return { allowed: true };
  if (!deviceHash) return { allowed: false, error: 'device_required' };
  const { results } = await env.DB.prepare('SELECT end_user_id FROM device_links WHERE project_id = ? AND device_hash = ?').bind(projectId, deviceHash).all();
  if (!results.length) return { allowed: true };
  if (endUserId && results.every((r) => r.end_user_id === endUserId)) return { allowed: true };
  return { allowed: false, error: 'device_limit' };
}
export async function logBlocked(env, projectId, deviceHash, endUserId) {
  await env.DB.prepare('INSERT INTO account_events (id, project_id, kind, device_hash, end_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), projectId, 'blocked', deviceHash || '', endUserId || '', new Date().toISOString()).run();
}
export async function recordLink(env, projectId, deviceHash, endUserId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO device_links (project_id, device_hash, end_user_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, device_hash, end_user_id) DO UPDATE SET last_seen = excluded.last_seen'
  ).bind(projectId, deviceHash, endUserId, now, now).run();
}

/** Accounts that share a device are treated as one person (union-find) so counts have no duplicates. */
export async function getStats(env, projectId, settings) {
  const accounts = (await env.DB.prepare('SELECT COUNT(*) AS n FROM end_users WHERE project_id = ?').bind(projectId).first()).n;
  const { results } = await env.DB.prepare('SELECT device_hash, end_user_id FROM device_links WHERE project_id = ? LIMIT 50000').bind(projectId).all();
  const parent = new Map(), find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const devices = new Map();
  for (const r of results) {
    if (!parent.has(r.end_user_id)) parent.set(r.end_user_id, r.end_user_id);
    if (!devices.has(r.device_hash)) devices.set(r.device_hash, []);
    devices.get(r.device_hash).push(r.end_user_id);
  }
  let shared = 0;
  for (const users of devices.values()) { if (users.length > 1) shared++; for (let i = 1; i < users.length; i++) parent.set(find(users[i]), find(users[0])); }
  const linked = new Set([...parent.keys()].map(find)).size, linkedAccounts = parent.size;
  const blocked = (await env.DB.prepare("SELECT COUNT(*) AS n FROM account_events WHERE project_id = ? AND kind = 'blocked'").bind(projectId).first()).n;
  return {
    enabled: settings.accountControl.enabled, mode: settings.accountControl.mode,
    accounts, devices: devices.size, sharedDevices: shared,
    estimatedUniqueUsers: Math.max(accounts - linkedAccounts, 0) + linked,
    duplicateAccounts: Math.max(linkedAccounts - linked, 0), blockedAttempts: blocked,
  };
}
