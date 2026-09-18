'use strict';

function required(env, key) {
  const value = env[key];
  if (!value || !String(value).trim()) throw new Error(`Missing required configuration: ${key}`);
  return String(value).trim();
}

function parseOrigins(value) {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) throw new Error('Missing required configuration: API_ALLOWED_ORIGINS');
  for (const origin of origins) {
    try {
      if (new URL(origin).origin !== origin) throw new Error('not an origin');
    } catch {
      throw new Error(`Invalid API_ALLOWED_ORIGINS entry: ${origin}`);
    }
  }
  return origins;
}

function parseConfig(env = process.env) {
  const environment = env.NODE_ENV || 'production';
  const allowedOrigins = parseOrigins(required(env, 'API_ALLOWED_ORIGINS'));
  const sessionHashPepper = required(env, 'SESSION_HASH_PEPPER');
  const cloudbaseApiKey = required(env, 'CLOUDBASE_APIKEY');
  const sessionCookieDomain = env.SESSION_COOKIE_DOMAIN && String(env.SESSION_COOKIE_DOMAIN).trim();
  if (environment === 'production' && !sessionCookieDomain) {
    throw new Error('Missing required configuration: SESSION_COOKIE_DOMAIN');
  }
  const bodyLimitBytes = Number(env.API_BODY_LIMIT_BYTES || 1024 * 1024);
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes < 1) throw new Error('Invalid API_BODY_LIMIT_BYTES');
  return {
    environment,
    allowedOrigins,
    sessionCookieName: env.SESSION_COOKIE_NAME || 'lv_session',
    csrfCookieName: env.CSRF_COOKIE_NAME || 'lv_csrf',
    cloudbaseApiKey,
    sessionCookieDomain: sessionCookieDomain || undefined,
    sessionHashPepper,
    rateLimitPepper: env.RATE_LIMIT_PEPPER || sessionHashPepper,
    bodyLimitBytes,
    csrfRequired: env.CSRF_REQUIRED !== 'false',
  };
}

module.exports = { parseConfig };
