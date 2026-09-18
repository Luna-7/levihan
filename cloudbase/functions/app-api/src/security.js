'use strict';

const crypto = require('crypto');
const { ApiError } = require('./errors');

function parseCookies(header) {
  if (!header) return {};
  return String(header).split(';').reduce((cookies, pair) => {
    const index = pair.indexOf('=');
    if (index < 1) return cookies;
    const name = pair.slice(0, index).trim();
    try { cookies[name] = decodeURIComponent(pair.slice(index + 1).trim()); } catch { /* ignore malformed cookie */ }
    return cookies;
  }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireCsrf(headers, cookies, config) {
  const pattern = /^[A-Za-z0-9_-]{32,128}$/;
  if (!pattern.test(cookies[config.csrfCookieName] || '') || !pattern.test(headers['x-csrf-token'] || '') || !secureEqual(cookies[config.csrfCookieName], headers['x-csrf-token'])) {
    throw new ApiError(403, 'ACCESS_DENIED', 'CSRF validation failed');
  }
}

function setSessionCookies(ctx, sessionToken, csrfToken) {
  const shared = { secure: true, sameSite: 'Lax', path: '/', domain: ctx.config.sessionCookieDomain };
  ctx.setCookie(serializeCookie(ctx.config.sessionCookieName, sessionToken, { ...shared, httpOnly: true }));
  ctx.setCookie(serializeCookie(ctx.config.csrfCookieName, csrfToken, shared));
}
function clearSessionCookies(ctx) {
  const shared = { secure: true, sameSite: 'Lax', path: '/', domain: ctx.config.sessionCookieDomain, maxAge: 0 };
  ctx.setCookie(serializeCookie(ctx.config.sessionCookieName, '', { ...shared, httpOnly: true }));
  ctx.setCookie(serializeCookie(ctx.config.csrfCookieName, '', shared));
}

function securityHeaders() {
  return {
    'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
  };
}

module.exports = { parseCookies, serializeCookie, requireCsrf, setSessionCookies, clearSessionCookies, securityHeaders };
