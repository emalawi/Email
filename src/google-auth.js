import { json, fail, randomHex, sha256Hex, safeEqual, cleanLine, getCookie } from './util.js';
import { escapeHtml } from './design.js';
import { getDeveloper } from './session.js';

const STATE_MINUTES = 10;
const CODE_SECONDS = 120;
const MAX_PENDING_STATES = 300;
const COOKIE = 'sb_oauth';
const COOKIE_PATH = '/auth/google';

function setCookie(value, maxAge) {
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${maxAge}`;
}

function errorPage(title, message, status = 400) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#f4f7fb;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box"><div style="max-width:480px;background:#fff;border-radius:16px;padding:36px;text-align:center;box-shadow:0 8px 35px rgba(0,0,0,.08)"><h1 style="margin:0 0 12px;color:#111827;font-size:24px">${escapeHtml(title)}</h1><p style="margin:0;color:#4b5563;line-height:1.6">${escapeHtml(message)}</p></div></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function redirect(location, extraHeaders = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) return null;
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchGoogleProfile(env, url, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    throw new Error('Google token error: ' + (data.error_description || data.error || res.status));
  }

  const p = decodeJwtPayload(data.id_token);
  const issuerOk = p && (p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com');
  if (!p || !issuerOk || p.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error('Google token did not match this app');
  }
  if (!p.exp || p.exp * 1000 < Date.now()) throw new Error('Google token expired');
  if (!p.sub || !p.email) throw new Error('Google profile is missing sub or email');

  const picture = String(p.picture || '');
  return {
    sub: String(p.sub),
    email: String(p.email).toLowerCase(),
    emailVerified: p.email_verified === true || p.email_verified === 'true',
    name: cleanLine(p.name, 200),
    picture: picture.startsWith('https://') ? picture.slice(0, 500) : '',
  };
}

async function saveUser(env, projectId, profile) {
  const now = new Date().toISOString();
  const find = () =>
    env.DB.prepare(
      'SELECT id FROM end_users WHERE project_id = ? AND provider = ? AND provider_user_id = ?'
    )
      .bind(projectId, 'google', profile.sub)
      .first();

  let existing = await find();
  if (!existing) {
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO end_users
         (id, project_id, provider, provider_user_id, email, email_verified, name, picture, created_at, last_login_at)
         VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          projectId,
          profile.sub,
          profile.email,
          profile.emailVerified ? 1 : 0,
          profile.name,
          profile.picture,
          now,
          now
        )
        .run();
      return id;
    } catch (err) {
      existing = await find();
      if (!existing) throw err;
    }
  }

  await env.DB.prepare(
    'UPDATE end_users SET email = ?, email_verified = ?, name = ?, picture = ?, last_login_at = ? WHERE id = ?'
  )
    .bind(profile.email, profile.emailVerified ? 1 : 0, profile.name, profile.picture, now, existing.id)
    .run();
  return existing.id;
}

async function startGoogle(env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return errorPage('Not configured', 'Google sign-in is not configured on this server.', 500);
  }

  const projectId = url.searchParams.get('project') || '';
  const redirectUrl = url.searchParams.get('redirect_url') || '';
  const clientState = cleanLine(url.searchParams.get('state'), 500);

  if (!/^[0-9a-f-]{36}$/.test(projectId)) {
    return errorPage('Invalid request', 'The project is missing or invalid.');
  }
  const project = await env.DB.prepare(
    'SELECT id, name, website, google_enabled FROM projects WHERE id = ?'
  )
    .bind(projectId)
    .first();
  if (!project || !project.google_enabled) {
    return errorPage('Google sign-in is off', 'Google sign-in is not enabled for this project.', 403);
  }
  if (!project.website) {
    return errorPage('Website missing', 'This project needs a website URL before users can sign in.');
  }

  let target;
  try {
    target = new URL(redirectUrl);
  } catch (err) {
    return errorPage('Invalid redirect', 'The redirect_url is missing or not a valid URL.');
  }
  if (target.origin !== project.website) {
    return errorPage('Redirect not allowed', `redirect_url must be on ${project.website}`);
  }

  const now = new Date();
  await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now.toISOString()).run();
  await env.DB.prepare('DELETE FROM auth_codes WHERE expires_at < ?').bind(now.toISOString()).run();

  const pending = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM oauth_states WHERE project_id = ? AND expires_at > ?'
  )
    .bind(project.id, now.toISOString())
    .first();
  if (pending.n >= MAX_PENDING_STATES) {
    return errorPage('Too many attempts', 'Please try again in a few minutes.', 429);
  }

  const state = randomHex(32);
  await env.DB.prepare(
    'INSERT INTO oauth_states (state_hash, project_id, redirect_url, client_state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(
      await sha256Hex(state),
      project.id,
      target.toString(),
      clientState,
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

  return redirect(google.toString(), { 'Set-Cookie': setCookie(state, STATE_MINUTES * 60) });
}

async function googleCallback(request, env, url) {
  const state = url.searchParams.get('state') || '';
  const cookieState = getCookie(request, COOKIE) || '';
  if (!/^[0-9a-f]{64}$/.test(state) || !safeEqual(state, cookieState)) {
    return errorPage('Sign-in expired', 'Please go back to the website and try signing in again.');
  }

  const stateHash = await sha256Hex(state);
  const row = await env.DB.prepare(
    'SELECT project_id, redirect_url, client_state, expires_at FROM oauth_states WHERE state_hash = ?'
  )
    .bind(stateHash)
    .first();
  await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ?').bind(stateHash).run();
  if (!row || new Date(row.expires_at) <= new Date()) {
    return errorPage('Sign-in expired', 'Please go back to the website and try signing in again.');
  }

  const back = (params) => {
    const dest = new URL(row.redirect_url);
    for (const [key, value] of Object.entries(params)) dest.searchParams.set(key, value);
    if (row.client_state) dest.searchParams.set('smartbase_state', row.client_state);
    return redirect(dest.toString(), { 'Set-Cookie': setCookie('', 0) });
  };

  if (url.searchParams.get('error')) return back({ smartbase_error: 'access_denied' });
  const code = url.searchParams.get('code');
  if (!code) return back({ smartbase_error: 'invalid_request' });

  const project = await env.DB.prepare('SELECT id, google_enabled FROM projects WHERE id = ?')
    .bind(row.project_id)
    .first();
  if (!project || !project.google_enabled) return back({ smartbase_error: 'provider_disabled' });

  let profile;
  try {
    profile = await fetchGoogleProfile(env, url, code);
  } catch (err) {
    console.error(err.message);
    return back({ smartbase_error: 'google_error' });
  }

  const userId = await saveUser(env, project.id, profile);

  const authCode = randomHex(32);
  const now = new Date();
  await env.DB.prepare(
    'INSERT INTO auth_codes (code_hash, project_id, end_user_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)'
  )
    .bind(
      await sha256Hex(authCode),
      project.id,
      userId,
      now.toISOString(),
      new Date(now.getTime() + CODE_SECONDS * 1000).toISOString()
    )
    .run();

  return back({ smartbase_code: authCode });
}

export async function handleGoogleAuth(request, env, url) {
  if (request.method !== 'GET') return errorPage('Not allowed', 'This address only accepts GET.', 405);
  if (url.pathname === '/auth/google/start') return await startGoogle(env, url);
  if (url.pathname === '/auth/google/callback') return await googleCallback(request, env, url);
  return errorPage('Not found', 'Unknown address.', 404);
}

function userJson(u) {
  return {
    id: u.id,
    provider: u.provider,
    provider_user_id: u.provider_user_id,
    email: u.email,
    email_verified: !!u.email_verified,
    name: u.name,
    picture: u.picture,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}

async function projectFromKey(request, env) {
  const key = request.headers.get('X-Smartbase-Key') || '';
  if (!/^sb_live_[0-9a-f]{48}$/.test(key)) return null;
  return await env.DB.prepare(
    `SELECT p.id, p.name, p.website
     FROM api_keys k JOIN projects p ON p.id = k.project_id
     WHERE k.key_hash = ? AND k.active = 1`
  )
    .bind(await sha256Hex(key))
    .first();
}

export async function handleGoogleExchange(request, env) {
  if (request.method !== 'POST') return fail('Method not allowed.', 405);
  const project = await projectFromKey(request, env);
  if (!project) return fail('Invalid or missing API key.', 401);

  const body = await request.json().catch(() => null);
  const code = String((body && body.code) || '');
  if (!/^[0-9a-f]{64}$/.test(code)) return fail('A valid "code" is required.');

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    'UPDATE auth_codes SET used = 1 WHERE code_hash = ? AND project_id = ? AND used = 0 AND expires_at > ? RETURNING end_user_id'
  )
    .bind(await sha256Hex(code), project.id, now)
    .first();
  if (!row) return fail('Code is invalid, expired, or already used.', 400);

  const user = await env.DB.prepare(
    'SELECT id, provider, provider_user_id, email, email_verified, name, picture, created_at, last_login_at FROM end_users WHERE id = ?'
  )
    .bind(row.end_user_id)
    .first();
  if (!user) return fail('User not found.', 404);
  return json({ success: true, user: userJson(user) });
}

async function ownedProject(env, developer, projectId) {
  return await env.DB.prepare(
    'SELECT id, name, website, google_enabled FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(String(projectId ?? ''), developer.id)
    .first();
}

export async function handleProviderApi(request, env, url) {
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return fail('Bad origin.', 403);
  }

  const developer = await getDeveloper(request, env);
  if (!developer) return fail('Please log in.', 401);

  if (url.pathname === '/api/providers' && request.method === 'GET') {
    const project = await ownedProject(env, developer, url.searchParams.get('projectId'));
    if (!project) return fail('Project not found.', 404);
    return json({
      success: true,
      projectId: project.id,
      website: project.website,
      callbackUrl: `${url.origin}/auth/google/callback`,
      google: {
        enabled: !!project.google_enabled,
        configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      },
    });
  }

  if (url.pathname === '/api/providers' && request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const project = await ownedProject(env, developer, body.projectId);
    if (!project) return fail('Project not found.', 404);
    const enabled = body.google === true;
    if (enabled && !project.website) {
      return fail('Set a website URL on this project before enabling Google sign-in.');
    }
    await env.DB.prepare('UPDATE projects SET google_enabled = ? WHERE id = ?')
      .bind(enabled ? 1 : 0, project.id)
      .run();
    return json({ success: true, google: { enabled } });
  }

  if (url.pathname === '/api/end-users' && request.method === 'GET') {
    const project = await ownedProject(env, developer, url.searchParams.get('projectId'));
    if (!project) return fail('Project not found.', 404);
    const { results } = await env.DB.prepare(
      `SELECT id, provider, provider_user_id, email, email_verified, name, picture, created_at, last_login_at
       FROM end_users WHERE project_id = ? ORDER BY last_login_at DESC LIMIT 100`
    )
      .bind(project.id)
      .all();
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM end_users WHERE project_id = ?')
      .bind(project.id)
      .first();
    return json({ success: true, total: total.n, users: results.map(userJson) });
  }

  return fail('Not found.', 404);
}
