import {
  json,
  fail,
  randomHex,
  sha256Hex,
  safeEqual,
  cleanLine,
  normalizeEmail,
  validEmail,
} from './util.js';
import { renderEmail, renderSubject, escapeHtml } from './design.js';
import { loadFlow, loadDesign, successPageResponse } from './flow.js';

const enc = new TextEncoder();
const TOKEN_MINUTES = 15;
const CODE_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const MAX_PER_EMAIL_HOUR = 3;
const MAX_PER_PROJECT_HOUR = 100;
const MAX_TESTS_PER_PROJECT_HOUR = 10;
const PAST = '1970-01-01T00:00:00.000Z';
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

function randomCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, '0');
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
  const flow = await loadFlow(env, project.id);
  const method = flow.method;
  const minutes = method === 'code' ? CODE_MINUTES : TOKEN_MINUTES;

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

  let token = '';
  let code = '';
  let tokenHash;
  let codeHash = '';
  if (method === 'code') {
    code = randomCode();
    tokenHash = await sha256Hex(randomHex(32));
    codeHash = await sha256Hex(`${project.id}:${email}:${code}`);
  } else {
    token = randomHex(32);
    tokenHash = await sha256Hex(token);
  }

  const expiresAt = new Date(now.getTime() + minutes * 60000).toISOString();
  await env.DB.prepare(
    `INSERT INTO verification_tokens
     (token_hash, project_id, email, name, created_at, expires_at, redirect_url, is_test, kind, code_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      tokenHash,
      project.id,
      email,
      name,
      now.toISOString(),
      expiresAt,
      redirectUrl || '',
      isTest ? 1 : 0,
      method,
      codeHash
    )
    .run();

  const { design, version } = await loadDesign(env, project);
  const vars = {
    projectName: project.name,
    name,
    email,
    verificationUrl: method === 'link' ? `${url.origin}/verify/${token}` : '',
    code,
    codeLabel: flow.codeLabel,
    expiryMinutes: minutes,
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

  if (method === 'code') {
    await env.DB.prepare(
      `UPDATE verification_tokens SET expires_at = ?
       WHERE project_id = ? AND email = ? AND kind = 'code' AND is_test = ?
       AND token_hash != ? AND expires_at > ?`
    )
      .bind(PAST, project.id, email, isTest ? 1 : 0, tokenHash, now.toISOString())
      .run();
  }

  return { ok: true, method, expiresInMinutes: minutes };
}

export async function checkCode(env, project, email, code, isTest) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT token_hash, code_hash FROM verification_tokens
     WHERE project_id = ? AND email = ? AND kind = 'code' AND is_test = ? AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(project.id, email, isTest ? 1 : 0, now)
    .first();
  if (!row) {
    return { ok: false, status: 400, message: 'Code expired or not found. Request a new code.' };
  }

  const bumped = await env.DB.prepare(
    'UPDATE verification_tokens SET attempts = attempts + 1 WHERE token_hash = ? AND attempts < ? RETURNING attempts'
  )
    .bind(row.token_hash, MAX_CODE_ATTEMPTS)
    .first();
  if (!bumped) {
    return { ok: false, status: 429, message: 'Too many wrong attempts. Request a new code.' };
  }

  const given = await sha256Hex(`${project.id}:${email}:${String(code).trim()}`);
  if (!safeEqual(given, row.code_hash)) {
    const left = MAX_CODE_ATTEMPTS - bumped.attempts;
    return {
      ok: false,
      status: 400,
      message: left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many wrong attempts. Request a new code.',
    };
  }

  const statements = [
    env.DB.prepare(
      'UPDATE verification_tokens SET expires_at = ?, verified_at = ? WHERE token_hash = ?'
    ).bind(PAST, now, row.token_hash),
  ];
  if (!isTest) {
    statements.unshift(
      env.DB.prepare(
        'INSERT OR REPLACE INTO verified_emails (project_id, email, verified_at) VALUES (?, ?, ?)'
      ).bind(project.id, email, now)
    );
  }
  await env.DB.batch(statements);
  return { ok: true };
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
    method: result.method,
    message: result.method === 'code' ? 'Verification code sent.' : 'Verification email sent.',
    expires_in_minutes: result.expiresInMinutes,
  });
}

async function verifyCodeRequest(request, env, project) {
  const body = await request.json().catch(() => null);
  if (!body) return fail('Send a JSON body with "email" and "code".');
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? '').trim();
  if (!validEmail(email)) return fail('A valid "email" is required.');
  if (!/^\d{6}$/.test(code)) return fail('A 6-digit "code" is required.');

  const result = await checkCode(env, project, email, code, false);
  if (!result.ok) return fail(result.message, result.status);
  return json({ success: true, email, verified: true });
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
  if (url.pathname === '/api/v1/verify-code' && request.method === 'POST') {
    return await verifyCodeRequest(request, env, project);
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
    `SELECT t.email, t.expires_at, t.redirect_url, t.project_id, t.is_test, p.name AS project_name, p.website
     FROM verification_tokens t JOIN projects p ON p.id = t.project_id
     WHERE t.token_hash = ? AND t.kind = 'link'`
  )
    .bind(tokenHash)
    .first();
  if (!row || new Date(row.expires_at) <= new Date()) return invalid();

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      'UPDATE verification_tokens SET expires_at = ?, verified_at = ? WHERE token_hash = ?'
    ).bind(PAST, now, tokenHash),
  ];
  if (!row.is_test) {
    statements.unshift(
      env.DB.prepare(
        'INSERT OR REPLACE INTO verified_emails (project_id, email, verified_at) VALUES (?, ?, ?)'
      ).bind(row.project_id, row.email, now)
    );
  }
  await env.DB.batch(statements);

  const flow = await loadFlow(env, row.project_id);
  const target = row.redirect_url || row.website;
  let targetUrl = '';
  if (target) {
    const dest = new URL(target);
    dest.searchParams.set('smartbase_status', 'verified');
    dest.searchParams.set('email', row.email);
    if (row.is_test) dest.searchParams.set('test', '1');
    targetUrl = dest.toString();
  }

  if (flow.afterMode === 'redirect' && targetUrl) {
    return new Response(null, {
      status: 302,
      headers: { Location: targetUrl, 'Cache-Control': 'no-store' },
    });
  }

  const project = { id: row.project_id, name: row.project_name };
  const { design, version } = await loadDesign(env, project);
  return successPageResponse(design, flow, {
    projectName: row.project_name,
    email: row.email,
    buttonUrl: targetUrl,
    logoUrl: `${url.origin}/img/${row.project_id}/logo?v=${version}`,
    notice: row.is_test
      ? 'This was a test, so the address was not marked as verified in production.'
      : '',
  });
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
