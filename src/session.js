import { sha256Hex, getCookie } from './util.js';

export async function getDeveloper(request, env) {
  const token = getCookie(request, 'sb_session');
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT u.id, u.name, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?'
  )
    .bind(id)
    .first();
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, name: row.name, email: row.email };
}
