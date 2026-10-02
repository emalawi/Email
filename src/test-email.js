import { json, fail, normalizeEmail, validEmail, cleanLine } from './util.js';
import { getDeveloper } from './session.js';
import { issueVerification, checkCode } from './public-api.js';

async function ownedProject(env, developer, projectId) {
  return await env.DB.prepare(
    'SELECT id, name, website FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(String(projectId ?? ''), developer.id)
    .first();
}

export async function handleTestApi(request, env, url) {
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return fail('Bad origin.', 403);
  }

  const developer = await getDeveloper(request, env);
  if (!developer) return fail('Please log in.', 401);

  if (url.pathname === '/api/test-status' && request.method === 'GET') {
    const project = await ownedProject(env, developer, url.searchParams.get('projectId'));
    if (!project) return fail('Project not found.', 404);
    const email = normalizeEmail(url.searchParams.get('email'));
    if (!validEmail(email)) return fail('Enter a valid email address.');
    const row = await env.DB.prepare(
      `SELECT kind, verified_at FROM verification_tokens
       WHERE project_id = ? AND email = ? AND is_test = 1
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(project.id, email)
      .first();
    return json({
      success: true,
      found: !!row,
      method: row ? row.kind : null,
      verified: !!(row && row.verified_at),
      verifiedAt: row ? row.verified_at : null,
    });
  }

  if (request.method !== 'POST') return fail('Method not allowed.', 405);

  const body = await request.json().catch(() => null);
  if (!body) return fail('Invalid request.');
  const project = await ownedProject(env, developer, body.projectId);
  if (!project) return fail('Project not found.', 404);
  const email = normalizeEmail(body.email);
  if (!validEmail(email) || /[<>",;]/.test(email)) {
    return fail('Enter a valid email address.');
  }

  if (url.pathname === '/api/test-email') {
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
      method: result.method,
      message: 'Test email sent.',
      expires_in_minutes: result.expiresInMinutes,
    });
  }

  if (url.pathname === '/api/test-verify-code') {
    const code = String(body.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code.');
    const result = await checkCode(env, project, email, code, true);
    if (!result.ok) return fail(result.message, result.status);
    return json({ success: true, verified: true });
  }

  return fail('Not found.', 404);
}
