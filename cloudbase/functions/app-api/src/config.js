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
  if (sessionHashPepper.length < 32) throw new Error('SESSION_HASH_PEPPER must be at least 32 characters');
  const cloudbaseApiKey = required(env, 'CLOUDBASE_APIKEY');
  const cosBucket = required(env, 'COS_BUCKET');
  const cosRegion = required(env, 'COS_REGION');
  const databaseSchema = required(env, 'DATABASE_SCHEMA');
  const sessionCookieDomain = env.SESSION_COOKIE_DOMAIN && String(env.SESSION_COOKIE_DOMAIN).trim();
  if (environment === 'production' && !sessionCookieDomain) {
    throw new Error('Missing required configuration: SESSION_COOKIE_DOMAIN');
  }
  if (sessionCookieDomain && !/^\.?[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(sessionCookieDomain)) {
    throw new Error('Invalid SESSION_COOKIE_DOMAIN');
  }
  if (environment === 'production' && env.CSRF_REQUIRED === 'false') throw new Error('CSRF_REQUIRED cannot be false in production');
  for (const value of [env.SESSION_COOKIE_NAME || 'lv_session', env.CSRF_COOKIE_NAME || 'lv_csrf']) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)) throw new Error('Cookie names must be valid HTTP token names');
  }
  const bodyLimitBytes = Number(env.API_BODY_LIMIT_BYTES || 1024 * 1024);
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes < 1) throw new Error('Invalid API_BODY_LIMIT_BYTES');
  const rateLimitPepper = env.RATE_LIMIT_PEPPER === undefined || String(env.RATE_LIMIT_PEPPER).trim() === '' ? sessionHashPepper : String(env.RATE_LIMIT_PEPPER).trim();
  if (rateLimitPepper.length < 32) throw new Error('RATE_LIMIT_PEPPER must be at least 32 characters');
  return {
    environment,
    allowedOrigins,
    sessionCookieName: env.SESSION_COOKIE_NAME || 'lv_session',
    csrfCookieName: env.CSRF_COOKIE_NAME || 'lv_csrf',
    cloudbaseApiKey,
    cosBucket,
    cosRegion,
    databaseSchema,
    sessionCookieDomain: sessionCookieDomain || undefined,
    sessionHashPepper,
    rateLimitPepper,
    bodyLimitBytes,
    csrfRequired: env.CSRF_REQUIRED !== 'false',
    trustedProxyHeaders: env.TRUST_PROXY_HEADERS === 'true',
    gatewayPath: env.API_GATEWAY_PATH || '/api/v1',
  };
}

module.exports = { parseConfig };
