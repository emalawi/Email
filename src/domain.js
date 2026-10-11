// Custom sign-in domain ("Continue to dance.com"): the developer forwards https://their-domain/__smartbase/* to this platform.
export const PREFIX = '/__smartbase';
const OWN_SUFFIXES = ['.workers.dev', '.pages.dev'];

export function validHost(h) {
  h = String(h || '').trim().toLowerCase();
  if (!/^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,24}$/.test(h)) return '';
  if (OWN_SUFFIXES.some((s) => h.endsWith(s)) || /^\d+\.\d+/.test(h)) return '';
  return h;
}
/** Base URL where the browser reaches this platform for sign-in. */
export const publicBase = (settings, url) =>
  settings.domain.mode === 'custom' && settings.domain.host && settings.domain.verifiedAt ? `https://${settings.domain.host}${PREFIX}` : url.origin;
export const redirectUri = (settings, url) => publicBase(settings, url) + '/auth/google/callback';
export const cookiePath = (url) => (url.sbPrefix || '') + '/auth/google';

export function snippets(host, platformOrigin) {
  const target = new URL(platformOrigin).host;
  return {
    sdk: `Smartbase.init({ projectId: 'YOUR_PROJECT_ID', baseUrl: 'https://${host}${PREFIX}' });`,
    googleRedirect: `https://${host}${PREFIX}/auth/google/callback`,
    nginx: `location ${PREFIX}/ {\n  proxy_pass https://${target}/;\n  proxy_set_header Host ${target};\n  proxy_ssl_server_name on;\n  proxy_pass_header Set-Cookie;\n}`,
    cloudflareWorker: `// Route: ${host}${PREFIX}/*\nexport default {\n  async fetch(req) {\n    const u = new URL(req.url);\n    u.hostname = '${target}';\n    u.pathname = u.pathname.replace(/^${PREFIX}/, '');\n    return fetch(new Request(u, req));\n  }\n};`,
    vercel: `{ "rewrites": [{ "source": "${PREFIX}/:path*", "destination": "https://${target}/:path*" }] }`,
    netlify: `${PREFIX}/*  https://${target}/:splat  200`,
  };
}
export async function verifyDomain(host) {
  try {
    const res = await fetch(`https://${host}${PREFIX}/api/ping`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    return !!(res.ok && data && data.platform === 'smartbase-email');
  } catch (e) { return false; }
}
