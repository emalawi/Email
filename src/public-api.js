import { json, fail, randomHex, sha256Hex, cleanLine, normalizeEmail, validEmail } from './util.js';
import { DEFAULT_DESIGN, sanitizeDesign, renderEmail, renderSubject, escapeHtml } from './design.js';

const enc = new TextEncoder();
const TOKEN_MINUTES = 15;
const MAX_PER_EMAIL_HOUR = 3;
const MAX_PER_PROJECT_HOUR = 100;
const MAX_TESTS_PER_PROJECT_HOUR = 10;
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

function pickReplyTo(address) {
  const value = String(address || '').trim();
  return /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(value) ? value : '';
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

async function sendGmail(env, to, subject, html, fromName, replyTo) {
  const accessToken = await getAccessToken(env);
  const lines = [];
  if (env.SENDER_EMAIL) {
    lines.push(`From: =?utf-8?B?${b64Utf8(fromName)}?= <${env.SENDER_EMAIL}>`);
  }
  if (replyTo) {
    lines.push(`Reply-To: ${replyTo}`);
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
    `SELECT p.id, p.name, p.website, u.email AS owner_email
     FROM api_keys k
     JOIN projects p ON p.id = k.project_id
     JOIN users u ON u.id = p.user_id
     WHERE k.key_hash = ? AND k.active = 1`
  )
    .bind(hash)
    .first();
}

export async function issueVerification(env, url, project, opts) {
  const { email, name, redirectUrl, isTest } = opts;
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
    return { ok: false, status: 429, message: 'Too many emails sent to this address. Try again later.' };
  }
  const perProject = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM verification_tokens WHERE project_id = ? AND created_at > ?'
  )
    .bind(project.id, hourAgo)
    .first();
  if (perProject.n >= MAX_PER_PROJECT_HOUR) {
    return { ok: false, status: 429, message: 'Hourly sending limit reached for this project.' };
  }
  if (isTest) {
    const tests = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM verification_tokens WHERE project_id = ? AND is_test = 1 AND created_at > ?'
    )
      .bind(project.id, hourAgo)
      .first();
    if (tests.n >= MAX_TESTS_PER_PROJECT_HOUR) {
      return { ok: false, status: 429, message: 'Test limit reached. Try again in an hour.' };
    }
  }

  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(now.getTime() + TOKEN_MINUTES * 60000).toISOString();
  await env.DB.prepare(
    'INSERT INTO verification_tokens (token_hash, project_id, email, name, created_at, expires_at, redirect_url, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(tokenHash, project.id, email, name, now.toISOString(), expiresAt, redirectUrl || '', isTest ? 1 : 0)
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
  const replyTo = pickReplyTo(design.supportEmail) || pickReplyTo(project.owner_email);

  try {
    await sendGmail(env, email, renderSubject(design, vars), renderEmail(design, vars), project.name, replyTo);
  } catch (err) {
    console.error(err.message);
    await env.DB.prepare('DELETE FROM verification_tokens WHERE token_hash = ?').bind(tokenHash).run();
    return { ok: false, status: 502, message: 'Could not send the email. Please try again later.' };
  }

  return { ok: true, expiresInMinutes: TOKEN_MINUTES };
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

  const result = await issueVerification(env, url, project, {
    email,
    name,
    redirectUrl,
    isTest: false,
  });
  if (!result.ok) return fail(result.message, result.status);

  return json({
    success: true,
    message: 'Verification email sent.',
    expires_in_minutes: result.expiresInMinutes,
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

function page(title, message, status = 200, linkUrl = '') {
  const link = linkUrl
    ? `<p style="margin:22px 0 0"><a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:700">Open website</a></p>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#f4f7fb;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box"><div style="max-width:480px;background:#fff;border-radius:16px;padding:36px;text-align:center;box-shadow:0 8px 35px rgba(0,0,0,.08)"><h1 style="margin:0 0 12px;color:#111827">${escapeHtml(title)}</h1><p style="margin:0;color:#4b5563;line-height:1.6">${escapeHtml(message)}</p>${link}</div></body></html>`;
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
    `SELECT t.email, t.expires_at, t.redirect_url, t.project_id, t.is_test, p.name AS project_name, p.website
     FROM verification_tokens t JOIN projects p ON p.id = t.project_id
     WHERE t.token_hash = ?`
  )
    .bind(tokenHash)
    .first();
  if (!row || new Date(row.expires_at) <= new Date()) return invalid();

  const burn = env.DB.prepare(
    'UPDATE verification_tokens SET expires_at = ? WHERE token_hash = ?'
  ).bind('1970-01-01T00:00:00.000Z', tokenHash);

  if (row.is_test) {
    await burn.run();
    return page(
      'Test successful',
      row.website
        ? `This was a test, so ${row.email} was not marked as verified. In production your user would be redirected to ${row.website} and counted as verified.`
        : `This was a test, so ${row.email} was not marked as verified. Add a website URL to your project and your users will be redirected there after verifying.`,
      200,
      row.website
    );
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR REPLACE INTO verified_emails (project_id, email, verified_at) VALUES (?, ?, ?)'
    ).bind(row.project_id, row.email, now),
    burn,
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
