const { timingSafeEqual, createHash } = require('node:crypto');

function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

function secure(req) {
  return req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function cookieName(req, type) {
  return `${secure(req) ? '__Host-' : ''}granfort-${type}`;
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

function setCookie(req, res, type, value, seconds) {
  const cookie = `${cookieName(req, type)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure(req) ? '; Secure' : ''}`;
  const existing = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), cookie]);
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).origin === new URL(`${secure(req) ? 'https' : 'http'}://${req.headers.host}`).origin;
  } catch {
    return false;
  }
}

async function readBody(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!['application/x-www-form-urlencoded', 'application/json'].includes(type)) throw new Error('BAD_BODY');
  if (Number(req.headers['content-length']) > 8192) throw new Error('BAD_BODY');
  const parsed = req.body;
  if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed)) {
    if (Array.isArray(parsed) || Buffer.byteLength(JSON.stringify(parsed)) > 8192) throw new Error('BAD_BODY');
    return parsed;
  }
  let text = typeof parsed === 'string' || Buffer.isBuffer(parsed) ? String(parsed) : '';
  if (parsed === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 8192) throw new Error('BAD_BODY');
      chunks.push(bytes);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(text) > 8192) throw new Error('BAD_BODY');
  if (type === 'application/json') {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BAD_BODY');
    return value;
  }
  const params = new URLSearchParams(text);
  const value = Object.create(null);
  for (const [name, content] of params) {
    if (Object.hasOwn(value, name)) throw new Error('BAD_BODY');
    value[name] = content;
  }
  return value;
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(body);
}

function redirect(res) {
  res.statusCode = 303;
  res.setHeader('Location', '/admin.php');
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

module.exports = { escape, equal, secure, cookieName, readCookie, setCookie, sameOrigin, readBody, html, redirect };
