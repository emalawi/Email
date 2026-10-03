import { json, fail, randomHex, sha256Hex } from './util.js';
import { getDeveloper } from './session.js';
import { escapeHtml } from './design.js';

const STATE_MINUTES = 10;

function plainPage(message, status) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;padding:30px;line-height:1.6">${escapeHtml(message)}</body>`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
}

async function testStart(request, env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return plainPage('Google sign-in is not configured on this server.', 500);
  }
  const developer = await getDeveloper(request, env);
  if (!developer) return plainPage('Please log in to the dashboard first.', 401);

  const projectId = url.searchParams.get('project') || '';
  const project = await env.DB.prepare(
    'SELECT id, google_enabled FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(projectId, developer.id)
    .first();
  if (!project) return plainPage('Project not found.', 404);
  if (!project.google_enabled) {
    return plainPage('Turn on Google sign-in for this project first.', 400);
  }

  const now = new Date();
  const state = randomHex(32);
  await env.DB.prepare(
    'INSERT INTO oauth_states (state_hash, project_id, redirect_url, client_state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(
      await sha256Hex(state),
      project.id,
      `${url.origin}/?google_test=1`,
      'dashboard-test',
      now.toISOString(),
      new Date(now.getTime() + STATE_MINUTES * 60000).toISOString()
    )
    .run();

  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  google.searchParams.set('redirect_uri', `${url.origin}/auth/google/callback`);
  google.searchParams.set('response_type', 'code');
  google.searchParams.set('scope', 'openid email profile');
  google.searchParams.set('state', state);
  google.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      Location: google.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': `sb_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=${STATE_MINUTES * 60}`,
    },
  });
}

async function testResult(request, env, url) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return fail('Bad origin.', 403);

  const developer = await getDeveloper(request, env);
  if (!developer) return fail('Please log in.', 401);

  const body = await request.json().catch(() => null);
  const code = String((body && body.code) || '');
  if (!/^[0-9a-f]{64}$/.test(code)) return fail('A valid "code" is required.');

  const row = await env.DB.prepare(
    `UPDATE auth_codes SET used = 1
     WHERE code_hash = ? AND used = 0 AND expires_at > ?
       AND project_id IN (SELECT id FROM projects WHERE user_id = ?)
     RETURNING end_user_id`
  )
    .bind(await sha256Hex(code), new Date().toISOString(), developer.id)
    .first();
  if (!row) return fail('Code is invalid, expired, or already used.', 400);

  const user = await env.DB.prepare(
    'SELECT id, provider, provider_user_id, email, email_verified, name, picture, created_at, last_login_at FROM end_users WHERE id = ?'
  )
    .bind(row.end_user_id)
    .first();
  if (!user) return fail('User not found.', 404);

  return json({
    success: true,
    user: {
      id: user.id,
      provider: user.provider,
      provider_user_id: user.provider_user_id,
      email: user.email,
      email_verified: !!user.email_verified,
      name: user.name,
      picture: user.picture,
      created_at: user.created_at,
      last_login_at: user.last_login_at,
    },
  });
}

export async function handleGoogleTest(request, env, url) {
  if (url.pathname === '/auth/google/test-start' && request.method === 'GET') {
    return await testStart(request, env, url);
  }
  if (url.pathname === '/api/google-test-result' && request.method === 'POST') {
    return await testResult(request, env, url);
  }
  return fail('Not found.', 404);
}
