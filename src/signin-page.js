import { json, fail, cleanLine } from './util.js';
import { getDeveloper } from './session.js';
import { escapeHtml } from './design.js';

const FONTS = [
  'Arial, sans-serif',
  'Verdana, sans-serif',
  'Georgia, serif',
  'Tahoma, sans-serif',
  'Trebuchet MS, sans-serif',
];

export const TEMPLATES = [
  { id: 'aurora', name: 'Aurora', type: 'moving' },
  { id: 'bubbles', name: 'Bubbles', type: 'moving' },
  { id: 'stars', name: 'Starfield', type: 'moving' },
  { id: 'squares', name: 'Drifting squares', type: 'moving' },
  { id: 'shift', name: 'Color shift', type: 'moving' },
  { id: 'solid', name: 'Solid', type: 'static' },
  { id: 'gradient', name: 'Gradient', type: 'static' },
  { id: 'mesh', name: 'Mesh', type: 'static' },
  { id: 'dots', name: 'Dots', type: 'static' },
  { id: 'grid', name: 'Grid', type: 'static' },
];

export const DEFAULT_SIGNIN = {
  enabled: false,
  template: 'aurora',
  color1: '#0b1f2a',
  color2: '#2dd4bf',
  color3: '#818cf8',
  speed: 5,
  density: 14,
  angle: 135,
  heading: 'Sign in to {{projectName}}',
  subheading: 'Use your Google account to continue.',
  buttonText: 'Continue with Google',
  buttonStyle: 'light',
  accent: '#2563eb',
  cardBackground: '#ffffff',
  cardOpacity: 100,
  headingColor: '#111827',
  textColor: '#4b5563',
  cardRadius: 18,
  cardWidth: 400,
  fontFamily: 'Arial, sans-serif',
  showLogo: true,
  footerText: 'Secured by Smartbase',
};

const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

function color(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value).toLowerCase() : fallback;
}

function num(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function one(value, list, fallback) {
  return list.includes(value) ? value : fallback;
}

function txt(value, max, fallback, allowEmpty) {
  if (value === undefined || value === null) return fallback;
  const s = cleanLine(value, max);
  return s || (allowEmpty ? '' : fallback);
}

export function sanitizeSignin(input) {
  const d = input && typeof input === 'object' ? input : {};
  const base = DEFAULT_SIGNIN;
  return {
    enabled: d.enabled === true,
    template: one(d.template, TEMPLATE_IDS, base.template),
    color1: color(d.color1, base.color1),
    color2: color(d.color2, base.color2),
    color3: color(d.color3, base.color3),
    speed: num(d.speed, 1, 10, base.speed),
    density: num(d.density, 4, 40, base.density),
    angle: num(d.angle, 0, 360, base.angle),
    heading: txt(d.heading, 100, base.heading, false),
    subheading: txt(d.subheading, 200, base.subheading, true),
    buttonText: txt(d.buttonText, 40, base.buttonText, false),
    buttonStyle: one(d.buttonStyle, ['light', 'dark', 'accent'], base.buttonStyle),
    accent: color(d.accent, base.accent),
    cardBackground: color(d.cardBackground, base.cardBackground),
    cardOpacity: num(d.cardOpacity, 30, 100, base.cardOpacity),
    headingColor: color(d.headingColor, base.headingColor),
    textColor: color(d.textColor, base.textColor),
    cardRadius: num(d.cardRadius, 0, 40, base.cardRadius),
    cardWidth: one(Number(d.cardWidth), [360, 400, 440], base.cardWidth),
    fontFamily: one(d.fontFamily, FONTS, base.fontFamily),
    showLogo: d.showLogo !== false,
    footerText: txt(d.footerText, 120, base.footerText, true),
  };
}

export function loadSignin(raw) {
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    parsed = null;
  }
  return sanitizeSignin(parsed || DEFAULT_SIGNIN);
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function r0(value) {
  return Math.round(value);
}

function r1(value) {
  return value.toFixed(1);
}

function seconds(base, d) {
  return r1(base / (d.speed / 5));
}

const KEYFRAMES = `
@keyframes sbrise{0%{transform:translateY(0) scale(1);opacity:0}10%{opacity:var(--o)}100%{transform:translateY(-115vh) scale(1.25);opacity:0}}
@keyframes sbspin{0%{transform:translateY(0) rotate(0);opacity:0}10%{opacity:var(--o)}100%{transform:translateY(-115vh) rotate(360deg);opacity:0}}
@keyframes sbdrift{from{transform:translate(0,0) scale(1)}to{transform:translate(var(--dx),var(--dy)) scale(1.25)}}
@keyframes sbtwinkle{0%,100%{opacity:.15}50%{opacity:1}}
@keyframes sbshift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}`;

function background(d) {
  const c1 = d.color1;
  const c2 = d.color2;
  const c3 = d.color3;
  const n = d.density;
  let layers = '';

  switch (d.template) {
    case 'solid':
      return { css: `background:${c1}`, layers };
    case 'gradient':
      return { css: `background:linear-gradient(${d.angle}deg,${c1},${c2})`, layers };
    case 'mesh':
      return {
        css: `background:radial-gradient(at 18% 22%,${c2} 0,transparent 55%),radial-gradient(at 82% 28%,${c3} 0,transparent 55%),radial-gradient(at 40% 92%,${c2} 0,transparent 55%),${c1}`,
        layers,
      };
    case 'dots':
      return { css: `background:radial-gradient(${c2} 1.6px,transparent 1.6px) 0 0/24px 24px,${c1}`, layers };
    case 'grid':
      return {
        css: `background:linear-gradient(${c2} 1px,transparent 1px) 0 0/34px 34px,linear-gradient(90deg,${c2} 1px,transparent 1px) 0 0/34px 34px,${c1}`,
        layers,
      };
    case 'shift':
      return {
        css: `background:linear-gradient(${d.angle}deg,${c1},${c2},${c3},${c1});background-size:300% 300%;animation:sbshift ${seconds(14, d)}s ease infinite`,
        layers,
      };
    case 'aurora': {
      const blobColors = [c2, c3, c2, c3];
      for (let i = 0; i < 4; i++) {
        layers += `<i class="blob" style="left:${r0(rand(-10, 70))}%;top:${r0(rand(-10, 70))}%;width:${r0(rand(40, 65))}vmax;height:${r0(rand(40, 65))}vmax;background:${blobColors[i]};--dx:${r0(rand(-25, 25))}vw;--dy:${r0(rand(-20, 20))}vh;animation-duration:${seconds(rand(14, 24), d)}s;animation-delay:-${r1(rand(0, 20))}s"></i>`;
      }
      return { css: `background:${c1}`, layers };
    }
    case 'bubbles': {
      for (let i = 0; i < n; i++) {
        const s = r0(rand(14, 72));
        layers += `<i class="bub" style="left:${r0(rand(0, 100))}%;width:${s}px;height:${s}px;--o:${r1(rand(0.15, 0.5))};background:${i % 2 ? c2 : c3};animation-duration:${seconds(rand(9, 22), d)}s;animation-delay:-${r1(rand(0, 22))}s"></i>`;
      }
      return { css: `background:linear-gradient(180deg,${c1},${c1})`, layers };
    }
    case 'squares': {
      for (let i = 0; i < n; i++) {
        const s = r0(rand(16, 60));
        layers += `<i class="sq" style="left:${r0(rand(0, 100))}%;width:${s}px;height:${s}px;border-radius:${r0(rand(3, 10))}px;--o:${r1(rand(0.18, 0.5))};background:${i % 2 ? c2 : c3};animation-duration:${seconds(rand(11, 26), d)}s;animation-delay:-${r1(rand(0, 26))}s"></i>`;
      }
      return { css: `background:${c1}`, layers };
    }
    case 'stars':
    default: {
      for (let i = 0; i < n * 3; i++) {
        const s = r1(rand(1, 3));
        layers += `<i class="star" style="left:${r1(rand(0, 100))}%;top:${r1(rand(0, 100))}%;width:${s}px;height:${s}px;background:${i % 5 === 0 ? c3 : '#ffffff'};animation-duration:${seconds(rand(2, 6), d)}s;animation-delay:-${r1(rand(0, 6))}s"></i>`;
      }
      return { css: `background:radial-gradient(ellipse at 50% 120%,${c2},${c1} 70%)`, layers };
    }
  }
}

const GOOGLE_G =
  '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">' +
  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
  '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
  '</svg>';

export function renderSigninPage(d, ctx) {
  const bg = background(d);
  const fill = (text) => escapeHtml(text).split('{{projectName}}').join(escapeHtml(ctx.projectName));

  const cardBg =
    d.cardOpacity < 100
      ? `${rgba(d.cardBackground, d.cardOpacity / 100)};-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)`
      : d.cardBackground;

  const buttons = {
    light: 'background:#ffffff;color:#3c4043;border:1px solid #dadce0',
    dark: 'background:#131314;color:#e3e3e3;border:1px solid #131314',
    accent: `background:${d.accent};color:#ffffff;border:1px solid ${d.accent}`,
  };
  const badge = d.buttonStyle === 'light' ? '' : 'background:#ffffff;border-radius:50%;padding:3px;';

  const logo =
    d.showLogo && ctx.logoUrl
      ? `<img src="${escapeHtml(ctx.logoUrl)}" alt="" style="display:block;margin:0 auto 18px;max-width:140px;max-height:64px">`
      : '';
  const sub = d.subheading
    ? `<p style="margin:0 0 26px;color:${d.textColor};font-size:15px;line-height:1.6">${fill(d.subheading)}</p>`
    : '<div style="height:12px"></div>';
  const footer = d.footerText
    ? `<p style="margin:22px 0 0;color:${d.textColor};font-size:12px;opacity:.8">${fill(d.footerText)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${fill(d.heading)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{font-family:${d.fontFamily}}
.bg{position:fixed;inset:0;overflow:hidden;${bg.css}}
.blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:.55;animation:sbdrift ease-in-out infinite alternate}
.bub{position:absolute;bottom:-90px;border-radius:50%;animation:sbrise linear infinite}
.sq{position:absolute;bottom:-80px;animation:sbspin linear infinite}
.star{position:absolute;border-radius:50%;animation:sbtwinkle ease-in-out infinite}
.wrap{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{width:${d.cardWidth}px;max-width:100%;padding:38px 30px 32px;text-align:center;border-radius:${d.cardRadius}px;background:${cardBg};box-shadow:0 24px 70px rgba(0,0,0,.28)}
.btn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;padding:13px 16px;border-radius:10px;font:600 15px ${d.fontFamily};text-decoration:none;${buttons[d.buttonStyle]}}
.btn:focus-visible{outline:3px solid ${d.accent};outline-offset:3px}
.g{display:flex;${badge}}
${KEYFRAMES}
@media (prefers-reduced-motion:reduce){.bg,.bg *{animation:none!important}}
</style>
</head>
<body>
<div class="bg">${bg.layers}</div>
<main class="wrap">
<div class="card">
${logo}
<h1 style="margin:0 0 10px;color:${d.headingColor};font-size:24px;line-height:1.25">${fill(d.heading)}</h1>
${sub}
<a class="btn" href="${escapeHtml(ctx.googleUrl)}"><span class="g">${GOOGLE_G}</span>${escapeHtml(d.buttonText)}</a>
${footer}
</div>
</main>
</body>
</html>`;
}

async function logoUrlFor(env, origin, projectId) {
  const row = await env.DB.prepare('SELECT design FROM email_templates WHERE project_id = ?')
    .bind(projectId)
    .first();
  try {
    const design = row && row.design ? JSON.parse(row.design) : null;
    if (design && design.logoDataUrl) return `${origin}/img/${projectId}/logo`;
  } catch (err) {
    return '';
  }
  return '';
}

export async function brandGoogleRedirect(response, env, url) {
  if (response.status !== 302) return response;
  const location = response.headers.get('Location') || '';
  if (!location.startsWith('https://accounts.google.com/')) return response;

  const projectId = url.searchParams.get('project') || '';
  if (!/^[0-9a-f-]{36}$/.test(projectId)) return response;

  const row = await env.DB.prepare('SELECT name, signin_page FROM projects WHERE id = ?')
    .bind(projectId)
    .first();
  if (!row) return response;
  const design = loadSignin(row.signin_page);
  if (!design.enabled) return response;

  const html = renderSigninPage(design, {
    projectName: row.name,
    logoUrl: await logoUrlFor(env, url.origin, projectId),
    googleUrl: location,
  });

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  const cookie = response.headers.get('Set-Cookie');
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(html, { status: 200, headers });
}

async function ownedProject(env, developer, projectId) {
  return await env.DB.prepare(
    'SELECT id, name, signin_page FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(String(projectId ?? ''), developer.id)
    .first();
}

export async function handleSigninApi(request, env, url) {
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return fail('Bad origin.', 403);
  }

  const developer = await getDeveloper(request, env);
  if (!developer) return fail('Please log in.', 401);

  if (url.pathname === '/api/signin-page' && request.method === 'GET') {
    const project = await ownedProject(env, developer, url.searchParams.get('projectId'));
    if (!project) return fail('Project not found.', 404);
    return json({
      success: true,
      design: loadSignin(project.signin_page),
      defaults: DEFAULT_SIGNIN,
      templates: TEMPLATES,
    });
  }

  if (url.pathname === '/api/signin-page' && request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const project = await ownedProject(env, developer, body.projectId);
    if (!project) return fail('Project not found.', 404);
    const design = sanitizeSignin(body.design);
    await env.DB.prepare('UPDATE projects SET signin_page = ? WHERE id = ?')
      .bind(JSON.stringify(design), project.id)
      .run();
    return json({ success: true, design });
  }

  if (url.pathname === '/api/signin-preview' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body) return fail('Invalid request.');
    const project = await ownedProject(env, developer, body.projectId);
    if (!project) return fail('Project not found.', 404);
    const html = renderSigninPage(sanitizeSignin(body.design), {
      projectName: project.name,
      logoUrl: await logoUrlFor(env, url.origin, project.id),
      googleUrl: '#',
    });
    return json({ success: true, html });
  }

  return fail('Not found.', 404);
}
