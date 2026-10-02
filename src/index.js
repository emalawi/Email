const enc = new TextEncoder();
const SESSION_DAYS = 7;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function fail(message, status = 400) {
  return json({ success: false, message }, status);
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function randomHex(n) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return bytesToHex(new Uint8Array(buf));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function derive(password, saltBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bytesToHex(salt) + ':' + (await derive(password, salt));
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const computed = await derive(password, hexToBytes(saltHex));
  return safeEqual(computed, hashHex);
}

function cleanLine(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function sessionCookie(token, maxAge) {
  return `sb_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const id = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(id, userId, expires.toISOString(), now.toISOString())
    .run();
  return token;
}

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

function defaultTemplate(projectId) {
  return {
    id: crypto.randomUUID(),
    projectId,
    name: 'Default verification email',
    subject: 'Verify your email for {{projectName}}',
    html: `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;padding:30px">
  <div style="max-width:600px;margin:auto;background:#fff;border-radius:18px;padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:#111827">{{projectName}}</div>
    <h1 style="color:#111827">Verify your email</h1>
    <p style="color:#4b5563;font-size:16px">Hello {{name}}, please verify your email address to continue.</p>
    <p><a href="{{verification_url}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:700">Verify email</a></p>
    <p style="color:#6b7280;font-size:13px">This link expires in 15 minutes.</p>
  </div>
</body>
</html>`,
    updatedAt: new Date().toISOString(),
  };
}

function templateFromRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    subject: row.subject,
    html: row.html,
    updatedAt: row.updated_at,
  };
}

async function ownsProject(env, projectId, userId) {
  const row = await env.DB.prepare(
    'SELECT id FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(String(projectId ?? ''), userId)
    .first();
  return !!row;
}

async function handleDashboardApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return fail('Bad origin.', 403);
  }

  if (path === '/api/signup' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const name = cleanLine(body.name, 100);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    if (!name) return fail('Name is required.');
    if (!validEmail(email)) return fail('Enter a valid email address.');
    if (password.length < 8) return fail('Password must be at least 8 characters.');
    if (password.length > 200) return fail('Password is too long.');

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();
    if (existing) return fail('An account with this email already exists.', 409);

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    try {
      await env.DB.prepare(
        'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(user.id, user.name, user.email, user.passwordHash, user.createdAt)
        .run();
    } catch (err) {
      return fail('An account with this email already exists.', 409);
    }
    return json(
      { success: true, developer: { id: user.id, name: user.name, email: user.email } },
      201
    );
  }

  if (path === '/api/login' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    const user = await env.DB.prepare(
      'SELECT id, name, email, password_hash FROM users WHERE email = ?'
    )
      .bind(email)
      .first();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return fail('Invalid email or password.', 401);
    }
    const token = await createSession(env, user.id);
    return json(
      { success: true, developer: { id: user.id, name: user.name, email: user.email } },
      200,
      { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) }
    );
  }

  if (path === '/api/logout' && method === 'POST') {
    const token = getCookie(request, 'sb_session');
    if (token) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
        .bind(await sha256Hex(token))
        .run();
    }
    return json({ success: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const developer = await getDeveloper(request, env);
  if (!developer) return fail('Please log in.', 401);

  if (path === '/api/me' && method === 'GET') {
    return json({ success: true, developer });
  }

  if (path === '/api/projects' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, website, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC'
    )
      .bind(developer.id)
      .all();
    const projects = results.map((p) => ({
      id: p.id,
      name: p.name,
      website: p.website,
      createdAt: p.created_at,
    }));
    return json({ success: true, projects });
  }

  if (path === '/api/projects' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const name = cleanLine(body.name, 80);
    if (!name) return fail('Project name is required.');

    let website = '';
    const rawSite = cleanLine(body.website, 300);
    if (rawSite) {
      try {
        const parsed = new URL(rawSite);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return fail('Website must start with https:// or http://');
        }
        website = parsed.origin;
      } catch (err) {
        return fail('Enter a valid website URL, like https://example.com');
      }
    }

    const now = new Date().toISOString();
    const project = {
      id: crypto.randomUUID(),
      name,
      website,
      createdAt: now,
    };
    const apiKey = 'sb_live_' + randomHex(24);
    const keyHash = await sha256Hex(apiKey);
    const template = defaultTemplate(project.id);

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, user_id, name, website, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(project.id, developer.id, project.name, project.website, now),
      env.DB.prepare(
        'INSERT INTO api_keys (id, project_id, key_hash, key_prefix, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
      ).bind(crypto.randomUUID(), project.id, keyHash, apiKey.slice(0, 12), now),
      env.DB.prepare(
        'INSERT INTO email_templates (id, project_id, name, subject, html, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        template.id,
        project.id,
        template.name,
        template.subject,
        template.html,
        template.updatedAt
      ),
    ]);

    return json({ success: true, project, apiKey, template }, 201);
  }

  if (path === '/api/template' && method === 'GET') {
    const projectId = url.searchParams.get('projectId');
    if (!(await ownsProject(env, projectId, developer.id))) {
      return fail('Project not found.', 404);
    }
    const row = await env.DB.prepare(
      'SELECT id, project_id, name, subject, html, updated_at FROM email_templates WHERE project_id = ?'
    )
      .bind(projectId)
      .first();
    const template = row ? templateFromRow(row) : defaultTemplate(projectId);
    return json({ success: true, template });
  }

  if (path === '/api/template' && method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const { projectId } = body;
    if (!(await ownsProject(env, projectId, developer.id))) {
      return fail('Project not found.', 404);
    }
    const subject = cleanLine(body.subject, 200);
    const html = String(body.html ?? '');
    const name = cleanLine(body.name || 'Verification email', 100);
    if (!subject || !html) return fail('Subject and HTML are required.');
    if (html.length > 100000) return fail('Email design is too large.');

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO email_templates (id, project_id, name, subject, html, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         name = excluded.name,
         subject = excluded.subject,
         html = excluded.html,
         updated_at = excluded.updated_at`
    )
      .bind(crypto.randomUUID(), projectId, name, subject, html, now)
      .run();

    const row = await env.DB.prepare(
      'SELECT id, project_id, name, subject, html, updated_at FROM email_templates WHERE project_id = ?'
    )
      .bind(projectId)
      .first();
    return json({ success: true, template: templateFromRow(row) });
  }

  return fail('Not found.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/health') {
        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'"
        ).first();
        return json({
          success: true,
          platform: 'Smartbase Email Platform',
          status: 'running',
          tables: row.tables,
        });
      }

      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v1/')) {
        return await handleDashboardApi(request, env, url);
      }
    } catch (err) {
      console.error(err);
      return fail('Server error.', 500);
    }

    return env.ASSETS.fetch(request);
  },
};
