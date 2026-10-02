import { json, fail, randomHex, sha256Hex, cleanLine, normalizeEmail, validEmail } from './util.js';
import { DEFAULT_DESIGN, sanitizeDesign, renderEmail, renderSubject, escapeHtml } from './design.js';

const enc = new TextEncoder();
const TOKEN_MINUTES = 15;
const MAX_PER_EMAIL_HOUR = 3;
const MAX_PER_PROJECT_HOUR = 100;
let cachedToken = null;

function b64Utf8(text) {
  const bytes = enc.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(env) {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      refresh_token: env.REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Google token error: ' + (data.error_description || data.error));
  }
  cachedToken = {
    value: data.access_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

async function sendGmail(env, to, subject, html, fromName) {
  const accessToken = await getAccessToken(env);
  const lines = [];
  if (env.SENDER_EMAIL) {
    lines.push(`From: =?utf-8?B?${b64Utf8(fromName)}?= <${env.SENDER_EMAIL}>`);
  }
  lines.push(
    `To: ${to}`,
    `Subject: =?utf-8?B?${b64Utf8(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    (b64Utf8(html).match(/.{1,76}/g) || []).join('\r\n')
  );
  const raw = toBase64Url(b64Utf8(lines.join('\r\n')));
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('Gmail error: ' + ((data.error && data.error.message) || res.status));
  }
  return data;
}

async function projectFromKey(request, env) {
  const key = request.headers.get('X-Smartbase-Key') || '';
  if (!/^sb_live_[0-9a-f]{48}$/.test(key)) return null;
  const hash = await sha256Hex(key);
  return await env.DB.prepare(
    'SELECT p.id, p.name, p.website FROM api_keys k JOIN projects p ON p.id = k.project_id WHERE k.key_hash = ? AND k.active = 1'
  )
    .bind(hash)
    .first();
}

async function sendVerification(request, env, url, project) {
  const body = await request.json().catch(() => null);
  if (!body) return fail('Send a JSON body with an "email" field.');

  const email = normalizeEmail(body.email);
  if (!validEmail(email) || /[<>",;]/.test(email)) {
    return fail('A valid "email" is required.');
  }
  const name = cleanLine(body.name, 100) || 'there';

  let redirectUrl = '';
  if (body.redirect_url) {
    if (!project.website) {
      return fail('Set a website URL on this project before using redirect_url.');
    }
    try {
      const target = new URL(String(body.redirect_url));
      if (target.origin !== project.website) {
        return fail('redirect_url must be on your project website (' + project.website + ').');
      }
      redirectUrl = target.toString();
    } catch (err) {
      return fail('redirect_url is not a valid URL.');
    }
  }

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600000).toISOString();
  const dayAgo = new Date(now.getTime() - 86400000).toISOString();

  await env.DB.prepare('DELETE FROM verification_tokens WHERE created_at < ?').bind(dayAgo).run();

  const perEmail = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM verification_tokens WHERE project_id = ? AND email = ? AND created_at > ?'
  )
    .bind(project.id, email, hourAgo)
    .first();
  if (perEmail.n >= MAX_PER_EMAIL_HOUR) {
    return fail('Too many emails sent to this address. Try again later.', 429);
  }
  const perProject = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM verification_tokens WHERE project_id = ? AND created_at > ?'
  )
    .bind(project.id, hourAgo)
    .first();
  if (perProject.n >= MAX_PER_PROJECT_HOUR) {
    return fail('Hourly sending limit reached for this project.', 429);
  }

  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(now.getTime() + TOKEN_MINUTES * 60000).toISOString();
  await env.DB.prepare(
    'INSERT INTO verification_tokens (token_hash, project_id, email, name, created_at, expires_at, redirect_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(tokenHash, project.id, email, name, now.toISOString(), expiresAt, redirectUrl)
    .run();

  const row = await env.DB.prepare(
    'SELECT design, updated_at FROM email_templates WHERE project_id = ?'
  )
    .bind(project.id)
    .first();
  let stored = null;
  if (row && row.design) {
    try {
      stored = JSON.parse(row.design);
    } catch (err) {
      stored = null;
    }
  }
  const design = sanitizeDesign(stored || { ...DEFAULT_DESIGN, companyName: project.name });
  const version = encodeURIComponent((row && row.updated_at) || '');
  const vars = {
    projectName: project.name,
    name,
    email,
    verificationUrl: `${url.origin}/verify/${token}`,
    logoUrl: `${url.origin}/img/${project.id}/logo?v=${version}`,
    headerUrl: `${url.origin}/img/${project.id}/header?v=${version}`,
  };

  try {
    await sendGmail(env, email, renderSubject(design, vars), renderEmail(design, vars), project.name);
  } catch (err) {
    console.error(err.message);
    await env.DB.prepare('DELETE FROM verification_tokens WHERE token_hash = ?').bind(tokenHash).run();
    return fail('Could not send the email. Please try again later.', 502);
  }

  return json({
    success: true,
    message: 'Verification email sent.',
    expires_in_minutes: TOKEN_MINUTES,
  });
}

async function verificationStatus(env, url, project) {
  const email = normalizeEmail(url.searchParams.get('email'));
  if (!validEmail(email)) return fail('A valid "email" query parameter is required.');
  const row = await env.DB.prepare(
    'SELECT verified_at FROM verified_emails WHERE project_id = ? AND email = ?'
  )
    .bind(project.id, email)
    .first();
  return json({
    success: true,
    email,
    verified: !!row,
    verified_at: row ? row.verified_at : null,
  });
}

export async function handlePublicApi(request, env, url) {
  const project = await projectFromKey(request, env);
  if (!project) return fail('Invalid or missing API key.', 401);

  if (url.pathname === '/api/v1/send-verification' && request.method === 'POST') {
    return await sendVerification(request, env, url, project);
  }
  if (url.pathname === '/api/v1/status' && request.method === 'GET') {
    return await verificationStatus(env, url, project);
  }
  return fail('Not found.', 404);
}

function page(title, message, status = 200) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#f4f7fb;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box"><div style="max-width:480px;background:#fff;border-radius:16px;padding:36px;text-align:center;box-shadow:0 8px 35px rgba(0,0,0,.08)"><h1 style="margin:0 0 12px;color:#111827">${escapeHtml(title)}</h1><p style="margin:0;color:#4b5563;line-height:1.6">${escapeHtml(message)}</p></div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleVerify(request, env, url) {
  const token = url.pathname.slice('/verify/'.length);
  const invalid = () =>
    page('Link not valid', 'This verification link is invalid, expired, or already used.', 400);
  if (!/^[0-9a-f]{64}$/.test(token)) return invalid();

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT t.email, t.expires_at, t.redirect_url, t.project_id, p.name AS project_name, p.website
     FROM verification_tokens t JOIN projects p ON p.id = t.project_id
     WHERE t.token_hash = ?`
  )
    .bind(tokenHash)
    .first();
  if (!row || new Date(row.expires_at) <= new Date()) return invalid();

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR REPLACE INTO verified_emails (project_id, email, verified_at) VALUES (?, ?, ?)'
    ).bind(row.project_id, row.email, now),
    env.DB.prepare(
      'UPDATE verification_tokens SET expires_at = ? WHERE token_hash = ?'
    ).bind('1970-01-01T00:00:00.000Z', tokenHash),
  ]);

  const target = row.redirect_url || row.website;
  if (target) {
    const dest = new URL(target);
    dest.searchParams.set('smartbase_status', 'verified');
    dest.searchParams.set('email', row.email);
    return new Response(null, {
      status: 302,
      headers: { Location: dest.toString(), 'Cache-Control': 'no-store' },
    });
  }
  return page('Email verified', `${row.email} has been verified for ${row.project_name}.`);
}

export async function handleImage(request, env, url) {
  const match = url.pathname.match(/^\/img\/([0-9a-f-]{36})\/(logo|header)$/);
  if (!match) return new Response('Not found', { status: 404 });

  const row = await env.DB.prepare('SELECT design FROM email_templates WHERE project_id = ?')
    .bind(match[1])
    .first();
  let design = null;
  try {
    design = row && row.design ? JSON.parse(row.design) : null;
  } catch (err) {
    design = null;
  }
  const dataUrl = design ? (match[2] === 'logo' ? design.logoDataUrl : design.headerImageDataUrl) : '';
  const parts = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
  if (!parts) return new Response('Not found', { status: 404 });

  const binary = atob(parts[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      'Content-Type': parts[1],
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
