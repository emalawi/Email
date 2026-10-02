import { json, fail, sha256Hex, getCookie, normalizeEmail, validEmail, cleanLine } from './util.js';
import { issueVerification } from './public-api.js';

async function getDeveloper(request, env) {
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

export async function handleTestEmail(request, env, url) {
  if (request.method !== 'POST') return fail('Method not allowed.', 405);

  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return fail('Bad origin.', 403);

  const developer = await getDeveloper(request, env);
  if (!developer) return fail('Please log in.', 401);

  const body = await request.json().catch(() => null);
  if (!body) return fail('Invalid request.');

  const project = await env.DB.prepare(
    'SELECT id, name, website FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(String(body.projectId ?? ''), developer.id)
    .first();
  if (!project) return fail('Project not found.', 404);

  const email = normalizeEmail(body.email);
  if (!validEmail(email) || /[<>",;]/.test(email)) {
    return fail('Enter a valid email address.');
  }

  const result = await issueVerification(
    env,
    url,
    { ...project, owner_email: developer.email },
    {
      email,
      name: cleanLine(body.name, 100) || 'there',
      redirectUrl: '',
      isTest: true,
    }
  );
  if (!result.ok) return fail(result.message, result.status);

  return json({
    success: true,
    message: 'Test email sent.',
    expires_in_minutes: result.expiresInMinutes,
  });
}
