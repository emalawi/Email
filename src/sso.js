// Sign-in for the Email platform comes ONLY from Smartbase: a signed, 60-second, single-use link.
import { normalizeEmail, validEmail, cleanLine } from './util.js';
import { createSession, sessionCookie, SESSION_DAYS } from './dashboard.js';

const enc = new TextEncoder();
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const readJson = (s) => JSON.parse(new TextDecoder().decode(unb64u(s)));

export async function verifyLaunchToken(token, secret, nowMs = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const header = readJson(parts[0]);
  if (header.alg !== 'HS256') throw new Error('algorithm');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('HMAC', key, unb64u(parts[2]), enc.encode(parts[0] + '.' + parts[1])))) throw new Error('signature');
  const c = readJson(parts[1]), now = Math.floor(nowMs / 1000);
  if (c.iss !== 'smartbase' || c.aud !== 'smartbase-email') throw new Error('audience');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 100 || typeof c.jti !== 'string' || c.jti.length < 8 || c.jti.length > 100) throw new Error('claims');
  if (!Number.isFinite(c.iat) || !Number.isFinite(c.exp) || c.exp - c.iat > 120 || now > c.exp + 5 || c.iat > now + 30) throw new Error('expired');
  return c;
}

export const smartLink = (env) => (/^https:\/\//.test(env.SMARTBASE_URL || '') ? String(env.SMARTBASE_URL).replace(/\/+$/, '') : 'https://smart.emalawi.workers.dev');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (env, title, msg, status) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="font-family:Arial,sans-serif;max-width:440px;margin:14vh auto;padding:0 22px;text-align:center;color:#1f2937"><h2>${esc(title)}</h2><p>${esc(msg)}</p><p><a href="${esc(smartLink(env))}" style="display:inline-block;padding:12px 22px;border-radius:9px;background:#2563eb;color:#fff;text-decoration:none">Open Smartbase</a></p></body>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

export async function handleSso(request, env, url) {
  if (request.method !== 'GET') return page(env, 'Not allowed', 'Open the Email platform from your Smartbase dashboard.', 405);
  if (!env.SSO_SECRET || String(env.SSO_SECRET).length < 32) return page(env, 'Not set up yet', 'Single sign-in is not configured on this platform.', 503);
  let claims;
  try { claims = await verifyLaunchToken(url.searchParams.get('token'), String(env.SSO_SECRET)); }
  catch (e) { return page(env, 'This link is not valid', 'It may have expired. Open the Email platform again from your Smartbase dashboard.', 400); }

  const now = new Date();
  await env.DB.prepare('DELETE FROM sso_used WHERE expires_at < ?').bind(now.toISOString()).run();
  try { await env.DB.prepare('INSERT INTO sso_used (jti, expires_at) VALUES (?, ?)').bind(claims.jti, new Date(now.getTime() + 600000).toISOString()).run(); }
  catch (e) { return page(env, 'This link was already used', 'Open the Email platform again from your Smartbase dashboard.', 400); }

  let userId = null;
  const linked = await env.DB.prepare('SELECT u.id FROM sso_accounts a JOIN users u ON u.id = a.user_id WHERE a.smart_user_id = ?').bind(claims.sub).first();
  if (linked) userId = linked.id;
  else {
    const email = normalizeEmail(claims.email);
    const existing = validEmail(email) ? await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first() : null;
    if (existing) {
      // An older Email-platform account with this address: only a VERIFIED Smartbase email may take it over.
      if (claims.email_verified !== true) return page(env, 'Verify your email first', 'An Email platform account already uses this email address. Sign in to Smartbase with Google (verified email) to open it.', 403);
      userId = existing.id;
    } else {
      userId = crypto.randomUUID();
      const name = cleanLine(claims.name, 100) || (validEmail(email) ? email.split('@')[0] : 'Developer');
      try {
        await env.DB.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(userId, name, validEmail(email) ? email : `smart-${userId}@users.invalid`, 'sso-only', now.toISOString()).run();
      } catch (e) { return page(env, 'Could not create your account', 'Please try again in a moment.', 500); }
    }
    await env.DB.prepare('INSERT OR IGNORE INTO sso_accounts (smart_user_id, user_id, created_at) VALUES (?, ?, ?)').bind(claims.sub, userId, now.toISOString()).run();
    const final = await env.DB.prepare('SELECT user_id FROM sso_accounts WHERE smart_user_id = ?').bind(claims.sub).first();
    if (final) userId = final.user_id;
  }
  const token = await createSession(env, userId);
  return new Response(null, { status: 302, headers: { Location: '/?sso=1', 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
