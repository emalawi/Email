import { cleanLine } from './util.js';

const FONTS = [
  'Arial, sans-serif',
  'Verdana, sans-serif',
  'Georgia, serif',
  'Tahoma, sans-serif',
  'Trebuchet MS, sans-serif',
];
const ALIGN = ['left', 'center', 'right'];
const BUTTON_WIDTHS = ['auto', '220px', '280px', '100%'];
const CARD_WIDTHS = ['480px', '560px', '640px', '700px'];
const IMAGE_PATTERN = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 950000;

export const DEFAULT_DESIGN = {
  subject: 'Verify your email for {{projectName}}',
  heading: 'Verify your email',
  message: 'Hello {{name}}, please verify your email address to continue.',
  buttonText: 'Verify email',
  brandColor: '#2563eb',
  background: '#f4f7fb',
  companyName: '',
  logoDataUrl: '',
  logoPosition: 'center',
  logoWidth: 100,
  headerImageDataUrl: '',
  headingColor: '#111827',
  headingSize: 28,
  textColor: '#4b5563',
  textSize: 16,
  fontFamily: 'Arial, sans-serif',
  buttonColor: '#2563eb',
  buttonTextColor: '#ffffff',
  buttonWidth: '280px',
  buttonAlign: 'center',
  buttonRadius: 8,
  cardBackground: '#ffffff',
  cardWidth: '560px',
  cardRadius: 14,
  showDivider: true,
  footerText: '© {{projectName}}. All rights reserved.',
  footerColor: '#6b7280',
  supportEmail: '',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[c]));
}

function pickColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : fallback;
}

function pickNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function pickOne(value, list, fallback) {
  return list.includes(value) ? value : fallback;
}

function pickText(value, max, fallback) {
  return String(value ?? fallback).slice(0, max);
}

function pickImage(value) {
  const s = String(value ?? '');
  return s.length <= MAX_IMAGE_CHARS && IMAGE_PATTERN.test(s) ? s : '';
}

export function sanitizeDesign(input) {
  const d = input && typeof input === 'object' ? input : {};
  const base = DEFAULT_DESIGN;
  const support = String(d.supportEmail ?? '').trim().slice(0, 254);
  return {
    subject: cleanLine(d.subject, 200) || base.subject,
    heading: pickText(d.heading, 200, base.heading),
    message: pickText(d.message, 2000, base.message),
    buttonText: pickText(d.buttonText, 60, base.buttonText),
    brandColor: pickColor(d.brandColor, base.brandColor),
    background: pickColor(d.background, base.background),
    companyName: pickText(d.companyName, 100, base.companyName),
    logoDataUrl: pickImage(d.logoDataUrl),
    logoPosition: pickOne(d.logoPosition, ALIGN, base.logoPosition),
    logoWidth: pickNumber(d.logoWidth, 20, 400, base.logoWidth),
    headerImageDataUrl: pickImage(d.headerImageDataUrl),
    headingColor: pickColor(d.headingColor, base.headingColor),
    headingSize: pickNumber(d.headingSize, 14, 60, base.headingSize),
    textColor: pickColor(d.textColor, base.textColor),
    textSize: pickNumber(d.textSize, 11, 28, base.textSize),
    fontFamily: pickOne(d.fontFamily, FONTS, base.fontFamily),
    buttonColor: pickColor(d.buttonColor, base.buttonColor),
    buttonTextColor: pickColor(d.buttonTextColor, base.buttonTextColor),
    buttonWidth: pickOne(d.buttonWidth, BUTTON_WIDTHS, base.buttonWidth),
    buttonAlign: pickOne(d.buttonAlign, ALIGN, base.buttonAlign),
    buttonRadius: pickNumber(d.buttonRadius, 0, 40, base.buttonRadius),
    cardBackground: pickColor(d.cardBackground, base.cardBackground),
    cardWidth: pickOne(d.cardWidth, CARD_WIDTHS, base.cardWidth),
    cardRadius: pickNumber(d.cardRadius, 0, 40, base.cardRadius),
    showDivider: d.showDivider !== false,
    footerText: pickText(d.footerText, 500, base.footerText),
    footerColor: pickColor(d.footerColor, base.footerColor),
    supportEmail: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(support) ? support : '',
  };
}

function fill(text, vars) {
  return String(text)
    .split('{{projectName}}').join(escapeHtml(vars.projectName))
    .split('{{name}}').join(escapeHtml(vars.name))
    .split('{{email}}').join(escapeHtml(vars.email))
    .split('{{verification_url}}').join(vars.verificationUrl || '');
}

export function renderSubject(design, vars) {
  return cleanLine(
    String(design.subject)
      .split('{{projectName}}').join(vars.projectName)
      .split('{{name}}').join(vars.name)
      .split('{{email}}').join(vars.email),
    200
  );
}

export function renderEmail(design, vars) {
  const d = design;
  const logoSrc = d.logoDataUrl ? vars.logoUrl || d.logoDataUrl : '';
  const headerSrc = d.headerImageDataUrl ? vars.headerUrl || d.headerImageDataUrl : '';

  const banner = headerSrc
    ? `<img src="${headerSrc}" alt="" style="width:100%;max-height:220px;object-fit:cover;display:block;margin-bottom:25px;border-radius:${d.cardRadius}px ${d.cardRadius}px 0 0">`
    : '';
  const logo = logoSrc
    ? `<div style="text-align:${d.logoPosition};margin-bottom:20px"><img src="${logoSrc}" alt="" style="width:${d.logoWidth}px;max-width:100%;height:auto"></div>`
    : '';
  const company = d.companyName || '{{projectName}}';
  const divider = d.showDivider
    ? `<div style="height:1px;background:${d.brandColor};opacity:.18;margin:24px 0"></div>`
    : '';
  const support = d.supportEmail
    ? `<div style="margin-top:10px;font-size:13px;color:${d.textColor};text-align:center">Need help? <a href="mailto:${escapeHtml(d.supportEmail)}" style="color:${d.brandColor}">${escapeHtml(d.supportEmail)}</a></div>`
    : '';
  const buttonWidth = d.buttonWidth === 'auto' ? 'auto' : d.buttonWidth;

  const action = vars.code
    ? `<div style="text-align:center;margin:25px 0">
<div style="font-size:13px;color:${d.textColor};margin-bottom:10px">${escapeHtml(vars.codeLabel || 'Your verification code')}</div>
<div style="display:inline-block;padding:14px 22px;border-radius:${d.buttonRadius}px;background:${d.background};border:1px dashed ${d.brandColor};color:${d.headingColor};font-size:32px;font-weight:700;letter-spacing:8px;font-family:Courier New,monospace">${escapeHtml(vars.code)}</div>
<div style="font-size:12px;color:${d.footerColor};margin-top:12px">This code expires in ${escapeHtml(vars.expiryMinutes)} minutes. Never share it with anyone.</div>
</div>`
    : `<div style="text-align:${d.buttonAlign};margin:25px 0">
<a href="{{verification_url}}" style="display:inline-block;width:${buttonWidth};max-width:100%;padding:14px 24px;box-sizing:border-box;background:${d.buttonColor};color:${d.buttonTextColor};text-decoration:none;border-radius:${d.buttonRadius}px;font-weight:700;text-align:center">${escapeHtml(d.buttonText)}</a>
</div>`;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${d.background};font-family:${d.fontFamily}">
<div style="background:${d.background};padding:30px 15px">
<div style="width:${d.cardWidth};max-width:100%;margin:0 auto;background:${d.cardBackground};border-radius:${d.cardRadius}px;padding:36px;box-sizing:border-box">
${banner}
${logo}
<div style="text-align:center;font-size:13px;color:${d.brandColor};font-weight:700;margin-bottom:12px">${escapeHtml(company)}</div>
<h1 style="margin:0 0 18px;color:${d.headingColor};font-size:${d.headingSize}px;text-align:center;line-height:1.2">${escapeHtml(d.heading)}</h1>
<div style="color:${d.textColor};font-size:${d.textSize}px;line-height:1.7;text-align:center">${escapeHtml(d.message).replace(/\n/g, '<br>')}</div>
${divider}
${action}
${support}
<div style="margin-top:28px;color:${d.footerColor};font-size:12px;line-height:1.6;text-align:center">${escapeHtml(d.footerText).replace(/\n/g, '<br>')}</div>
</div>
</div>
</body>
</html>`;

  return fill(html, vars);
}
