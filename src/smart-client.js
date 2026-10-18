// Talks to the Smartbase database platform through its public API-key API (/apiv1).
import { getSecret } from './settings.js';

export const STANDARD_FIELDS = ['id', 'provider', 'provider_user_id', 'email', 'email_verified', 'name', 'picture', 'created_at', 'last_login_at', 'login_count'];
export const TEMPLATE_USERS = 'smartbase_users';
export const TEMPLATE_DEVICES = 'smartbase_devices';
export const TEMPLATE_SQL = `CREATE TABLE IF NOT EXISTS ${TEMPLATE_USERS} (id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL UNIQUE, email TEXT, email_verified INTEGER DEFAULT 0, name TEXT, picture TEXT, created_at TEXT, last_login_at TEXT, login_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ${TEMPLATE_DEVICES} (id TEXT PRIMARY KEY, device_hash TEXT NOT NULL, user_id TEXT NOT NULL, first_seen TEXT, last_seen TEXT);`;
export const IDENTITY_MAP = Object.fromEntries(STANDARD_FIELDS.map((f) => [f, f]));

export const smartUrl = (env) => String(env.SMARTBASE_URL || 'https://smartbase.de5.net').replace(/\/+$/, '');

export function ident(name) {
  const s = String(name || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(s)) throw Object.assign(new Error('Invalid table or column name: ' + s.slice(0, 40)), { status: 400 });
  return s;
}
export function sqlLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

export async function smart(env, key, method, path, body) {
  let res;
  try {
    res = await fetch(smartUrl(env) + '/apiv1' + path, {
      method,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
  } catch (e) { throw Object.assign(new Error('Could not reach the Smartbase platform.'), { status: 502 }); }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
function must(r) {
  if (r.status >= 200 && r.status < 300 && r.data.success !== false) return r.data;
  throw Object.assign(new Error(r.data.message || r.data.error || 'Smartbase request failed (' + r.status + ')'), { status: r.status, code: r.data.error });
}
export async function keys(env, projectId) {
  return { read: await getSecret(env, projectId, 'smart_read'), write: await getSecret(env, projectId, 'smart_write') };
}
export const listDatabases = async (env, readKey) => must(await smart(env, readKey, 'GET', '/databases')).databases || [];
export const runSql = async (env, key, databaseId, sql) => must(await smart(env, key, 'POST', '/query', { database_id: databaseId, sql }));

/** Which kind of key is this? 'write' | 'read' | null */
export async function probeKey(env, key) {
  const r = await smart(env, key, 'DELETE', '/databases/sb_db_probe_none');
  if (r.status === 404) return 'write';
  if (r.status === 403 && r.data.error === 'KEY_PERMISSION_DENIED') return 'read';
  return null;
}

/** SQL that inserts-or-updates one user row in a mapped table (one request, atomic). */
export function buildUserSql({ table, mapping, extra = {}, keyField, values, devices }) {
  const t = ident(table), map = {}, cols = [], vals = [], sets = [];
  for (const f of STANDARD_FIELDS) if (mapping[f]) map[f] = ident(mapping[f]);
  const key = keyField && map[keyField] ? keyField : map.provider_user_id ? 'provider_user_id' : 'email';
  if (!map[key]) throw new Error('The structure needs an email or provider_user_id column.');
  for (const f of STANDARD_FIELDS) {
    if (!map[f]) continue;
    cols.push(map[f]); vals.push(sqlLit(f === 'login_count' ? 1 : values[f]));
    if (f === 'id' || f === 'created_at' || f === key) continue;
    sets.push(f === 'login_count' ? `${map[f]} = COALESCE(${map[f]}, 0) + 1` : `${map[f]} = ${sqlLit(values[f])}`);
  }
  for (const [c, v] of Object.entries(extra)) { cols.push(ident(c)); vals.push(sqlLit(v)); }
  const where = `${map[key]} = ${sqlLit(values[key])}`;
  const parts = [];
  if (sets.length) parts.push(`UPDATE ${t} SET ${sets.join(', ')} WHERE ${where};`);
  parts.push(`INSERT INTO ${t} (${cols.join(', ')}) SELECT ${vals.join(', ')} WHERE NOT EXISTS (SELECT 1 FROM ${t} WHERE ${where});`);
  if (devices && devices.table && devices.deviceHash) {
    const d = ident(devices.table), w = `device_hash = ${sqlLit(devices.deviceHash)} AND user_id = ${sqlLit(values.id)}`;
    parts.push(`UPDATE ${d} SET last_seen = ${sqlLit(devices.at)} WHERE ${w};`);
    parts.push(`INSERT INTO ${d} (id, device_hash, user_id, first_seen, last_seen) SELECT ${sqlLit(crypto.randomUUID())}, ${sqlLit(devices.deviceHash)}, ${sqlLit(values.id)}, ${sqlLit(devices.at)}, ${sqlLit(devices.at)} WHERE NOT EXISTS (SELECT 1 FROM ${d} WHERE ${w});`);
  }
  return parts.join('\n');
}

/** Columns that exist in a table (via DESCRIBE with the read key). */
export async function tableColumns(env, readKey, databaseId, table) {
  const d = await runSql(env, readKey, databaseId, 'DESCRIBE ' + ident(table));
  return (d.rows || []).map((r) => String(r.Field).toLowerCase());
}
