import { encryptSecret, decryptSecret } from './google-creds.js';

export const DEFAULTS = () => ({
  domain: { mode: 'default', host: '', verifiedAt: null },
  storage: {
    mode: 'default', // default (platform D1) | smartbase | external
    smartbase: { connected: false, databaseId: '', databaseName: '', kind: 'template', table: 'smartbase_users', mapping: null, extra: {}, keyField: 'provider_user_id', devicesTable: '', ready: false, structureAt: null },
    external: { url: '', configured: false },
  },
  accountControl: { enabled: false, mode: 'monitor' }, // monitor | enforce
});

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = { ...base };
  for (const k of Object.keys(base)) {
    if (!(k in over)) continue;
    const b = base[k], o = over[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && b !== null && Object.keys(b).length ? merge(b, o) : o;
  }
  if ('mapping' in (over || {}) && 'mapping' in base) out.mapping = over.mapping;
  if ('extra' in (over || {}) && 'extra' in base) out.extra = over.extra;
  return out;
}

export async function getSettings(env, projectId) {
  const row = await env.DB.prepare('SELECT settings FROM project_settings WHERE project_id = ?').bind(projectId).first();
  let parsed = null;
  try { parsed = row ? JSON.parse(row.settings) : null; } catch (e) { parsed = null; }
  return merge(DEFAULTS(), parsed);
}

export async function saveSettings(env, projectId, settings) {
  await env.DB.prepare(
    'INSERT INTO project_settings (project_id, settings, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at'
  ).bind(projectId, JSON.stringify(settings), new Date().toISOString()).run();
  return settings;
}

const aad = (projectId, name) => `${projectId}:${name}`;
export async function setSecret(env, projectId, name, plain) {
  const enc = await encryptSecret(env, plain, aad(projectId, name));
  await env.DB.prepare(
    'INSERT INTO project_secrets (project_id, name, enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, name) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at'
  ).bind(projectId, name, enc, new Date().toISOString()).run();
}
export async function getSecret(env, projectId, name) {
  const row = await env.DB.prepare('SELECT enc FROM project_secrets WHERE project_id = ? AND name = ?').bind(projectId, name).first();
  if (!row) return null;
  try { return await decryptSecret(env, row.enc, aad(projectId, name)); } catch (e) { return null; }
}
export async function deleteSecret(env, projectId, name) {
  await env.DB.prepare('DELETE FROM project_secrets WHERE project_id = ? AND name = ?').bind(projectId, name).run();
}
