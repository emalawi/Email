import {
  json,
  fail,
  randomHex,
  sha256Hex,
  cleanLine,
  normalizeEmail,
  validEmail,
  getCookie,
  hashPassword,
  verifyPassword,
} from './util.js';
import { DEFAULT_DESIGN, sanitizeDesign } from './design.js';

const SESSION_DAYS = 7;
const MAX_DESIGN_CHARS = 1900000;

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

async function ownsProject(env, projectId, userId) {
  const row = await env.DB.prepare(
    'SELECT id, name FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(String(projectId ?? ''), userId)
    .first();
  return row || null;
}

function designToTemplate(row, projectName) {
  let design = null;
  if (row && row.design) {
    try {
      design = JSON.parse(row.design);
    } catch (err) {
      design = null;
    }
  }
  const merged = sanitizeDesign(design || DEFAULT_DESIGN);
  if (!design) merged.companyName = projectName;
  return {
    id: row ? row.id : null,
    projectId: row ? row.project_id : null,
    updatedAt: row ? row.updated_at : null,
    ...merged,
  };
}

async function newApiKey(env, projectId, now) {
  const apiKey = 'sb_live_' + randomHex(24);
  const keyHash = await sha256Hex(apiKey);
  const statement = env.DB.prepare(
    'INSERT INTO api_keys (id, project_id, key_hash, key_prefix, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).bind(crypto.randomUUID(), projectId, keyHash, apiKey.slice(0, 12), now);
  return { apiKey, statement };
}

export async function handleDashboardApi(request, env, url) {
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
      `SELECT p.id, p.name, p.website, p.created_at,
        (SELECT key_prefix FROM api_keys k
          WHERE k.project_id = p.id AND k.active = 1
          ORDER BY k.created_at DESC LIMIT 1) AS key_prefix
       FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`
    )
      .bind(developer.id)
      .all();
    const projects = results.map((p) => ({
      id: p.id,
      name: p.name,
      website: p.website,
      createdAt: p.created_at,
      keyPrefix: p.key_prefix || '',
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
    const project = { id: crypto.randomUUID(), name, website, createdAt: now };
    const key = await newApiKey(env, project.id, now);
    const design = { ...DEFAULT_DESIGN, companyName: name };

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, user_id, name, website, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(project.id, developer.id, project.name, project.website, now),
      key.statement,
      env.DB.prepare(
        'INSERT INTO email_templates (id, project_id, name, subject, html, design, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(),
        project.id,
        'Verification email',
        design.subject,
        '',
        JSON.stringify(design),
        now
      ),
    ]);

    return json(
      {
        success: true,
        project: { ...project, apiKey: key.apiKey, keyPrefix: key.apiKey.slice(0, 12) },
        apiKey: key.apiKey,
      },
      201
    );
  }

  if (path === '/api/projects/rotate-key' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const project = await ownsProject(env, body.projectId, developer.id);
    if (!project) return fail('Project not found.', 404);
    const now = new Date().toISOString();
    const key = await newApiKey(env, project.id, now);
    await env.DB.batch([
      env.DB.prepare('UPDATE api_keys SET active = 0 WHERE project_id = ?').bind(project.id),
      key.statement,
    ]);
    return json({ success: true, apiKey: key.apiKey, keyPrefix: key.apiKey.slice(0, 12) });
  }

  if (path === '/api/template' && method === 'GET') {
    const project = await ownsProject(env, url.searchParams.get('projectId'), developer.id);
    if (!project) return fail('Project not found.', 404);
    const row = await env.DB.prepare(
      'SELECT id, project_id, design, updated_at FROM email_templates WHERE project_id = ?'
    )
      .bind(project.id)
      .first();
    return json({ success: true, template: designToTemplate(row, project.name) });
  }

  if (path === '/api/template' && method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const project = await ownsProject(env, body.projectId, developer.id);
    if (!project) return fail('Project not found.', 404);

    const design = sanitizeDesign(body.template);
    const designJson = JSON.stringify(design);
    if (designJson.length > MAX_DESIGN_CHARS) return fail('Email design is too large.');

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO email_templates (id, project_id, name, subject, html, design, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         subject = excluded.subject,
         design = excluded.design,
         updated_at = excluded.updated_at`
    )
      .bind(crypto.randomUUID(), project.id, 'Verification email', design.subject, '', designJson, now)
      .run();

    const row = await env.DB.prepare(
      'SELECT id, project_id, design, updated_at FROM email_templates WHERE project_id = ?'
    )
      .bind(project.id)
      .first();
    return json({ success: true, template: designToTemplate(row, project.name) });
  }

  return fail('Not found.', 404);
}
