import { json, fail, cleanLine } from './util.js';
import { getDeveloper } from './session.js';
import { DEFAULT_DESIGN, sanitizeDesign, escapeHtml } from './design.js';

export const DEFAULT_FLOW = {
  method: 'link',
  codeLabel: 'Your verification code',
  afterMode: 'page',
  afterHeading: 'Email verified',
  afterMessage: '{{email}} has been verified for {{projectName}}. You can now continue.',
  afterButtonText: 'Open website',
  afterShowLogo: true,
};

function text(value, max, fallback) {
  return cleanLine(value, max) || fallback;
}

export function sanitizeFlow(input) {
  const f = input && typeof input === 'object' ? input : {};
  return {
    method: f.method === 'code' ? 'code' : 'link',
    codeLabel: text(f.codeLabel, 60, DEFAULT_FLOW.codeLabel),
    afterMode: f.afterMode === 'redirect' ? 'redirect' : 'page',
    afterHeading: text(f.afterHeading, 100, DEFAULT_FLOW.afterHeading),
    afterMessage: text(f.afterMessage, 400, DEFAULT_FLOW.afterMessage),
    afterButtonText: text(f.afterButtonText, 40, DEFAULT_FLOW.afterButtonText),
    afterShowLogo: f.afterShowLogo !== false,
  };
}

export async function loadFlow(env, projectId) {
  const row = await env.DB.prepare('SELECT flow FROM email_templates WHERE project_id = ?')
    .bind(projectId)
    .first();
  let stored = null;
  try {
    stored = row && row.flow ? JSON.parse(row.flow) : null;
  } catch (err) {
    stored = null;
  }
  return sanitizeFlow(stored);
}

export async function loadDesign(env, project) {
  const row = await env.DB.prepare(
    'SELECT design, updated_at FROM email_templates WHERE project_id = ?'
  )
    .bind(project.id)
    .first();
  let stored = null;
  try {
    stored = row && row.design ? JSON.parse(row.design) : null;
  } catch (err) {
    stored = null;
  }
  return {
    design: sanitizeDesign(stored || { ...DEFAULT_DESIGN, companyName: project.name }),
    version: encodeURIComponent((row && row.updated_at) || ''),
  };
}

export function successPageResponse(design, flow, ctx) {
  const d = design;
  const sub = (value) =>
    escapeHtml(value)
      .split('{{projectName}}').join(escapeHtml(ctx.projectName))
      .split('{{email}}').join(escapeHtml(ctx.email));

  const logo =
    d.logoDataUrl && flow.afterShowLogo && ctx.logoUrl
      ? `<img src="${escapeHtml(ctx.logoUrl)}" alt="" style="width:${d.logoWidth}px;max-width:100%;height:auto;display:block;margin:0 auto 22px">`
      : '';
  const button = ctx.buttonUrl
    ? `<a href="${escapeHtml(ctx.buttonUrl)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:28px;padding:14px 26px;background:${d.buttonColor};color:${d.buttonTextColor};text-decoration:none;border-radius:${d.buttonRadius}px;font-weight:700">${escapeHtml(flow.afterButtonText)}</a>`
    : '';
  const notice = ctx.notice
    ? `<p style="margin:26px 0 0;font-size:12px;color:${d.footerColor};line-height:1.5">${escapeHtml(ctx.notice)}</p>`
    : '';

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${sub(flow.afterHeading)}</title></head>
<body style="margin:0;font-family:${d.fontFamily};background:${d.background};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box">
<div style="width:${d.cardWidth};max-width:100%;background:${d.cardBackground};border-radius:${d.cardRadius}px;padding:40px 32px;box-sizing:border-box;text-align:center;box-shadow:0 8px 35px rgba(0,0,0,.08)">
${logo}
<div style="width:64px;height:64px;border-radius:50%;background:${d.brandColor};color:#ffffff;font-size:34px;line-height:64px;margin:0 auto 20px">✓</div>
<h1 style="margin:0 0 14px;color:${d.headingColor};font-size:${d.headingSize}px;line-height:1.2">${sub(flow.afterHeading)}</h1>
<p style="margin:0;color:${d.textColor};font-size:${d.textSize}px;line-height:1.7">${sub(flow.afterMessage)}</p>
${button}
${notice}
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

async function ownedProject(env, developer, projectId) {
  return await env.DB.prepare(
    'SELECT id, name, website FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(String(projectId ?? ''), developer.id)
    .first();
}

export async function handleFlowApi(request, env, url) {
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return fail('Bad origin.', 403);
  }

  const developer = await getDeveloper(request, env);
  const isPreview = url.pathname === '/preview/success';
  if (!developer) {
    return isPreview
      ? new Response('Please log in to the dashboard first.', { status: 401 })
      : fail('Please log in.', 401);
  }

  if (url.pathname === '/api/flow' && request.method === 'GET') {
    const project = await ownedProject(env, developer, url.searchParams.get('projectId'));
    if (!project) return fail('Project not found.', 404);
    return json({ success: true, flow: await loadFlow(env, project.id) });
  }

  if (url.pathname === '/api/flow' && request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const project = await ownedProject(env, developer, body.projectId);
    if (!project) return fail('Project not found.', 404);

    const flow = sanitizeFlow(body.flow);
    await env.DB.prepare(
      `INSERT INTO email_templates (id, project_id, name, subject, html, design, flow, updated_at)
       VALUES (?, ?, 'Verification email', ?, '', NULL, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET flow = excluded.flow`
    )
      .bind(
        crypto.randomUUID(),
        project.id,
        DEFAULT_DESIGN.subject,
        JSON.stringify(flow),
        new Date().toISOString()
      )
      .run();
    return json({ success: true, flow });
  }

  if (isPreview && request.method === 'GET') {
    const project = await ownedProject(env, developer, url.searchParams.get('projectId'));
    if (!project) return new Response('Project not found.', { status: 404 });
    const flow = await loadFlow(env, project.id);
    const { design, version } = await loadDesign(env, project);
    return successPageResponse(design, flow, {
      projectName: project.name,
      email: 'user@example.com',
      buttonUrl: project.website,
      logoUrl: `${url.origin}/img/${project.id}/logo?v=${version}`,
      notice: 'Preview of your success page.',
    });
  }

  return fail('Not found.', 404);
}
