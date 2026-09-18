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
  const authHashPepper = required(env, 'AUTH_HASH_PEPPER');
  if (authHashPepper.length < 32) throw new Error('AUTH_HASH_PEPPER must be at least 32 characters');
  const cloudbaseApiKey = required(env, 'CLOUDBASE_APIKEY');
  const legacyCosBucket = env.COS_BUCKET && String(env.COS_BUCKET).trim();
  const cosPublicBucket = env.COS_PUBLIC_BUCKET && String(env.COS_PUBLIC_BUCKET).trim() || (environment === 'production' ? '' : legacyCosBucket);
  const cosPrivateBucket = env.COS_PRIVATE_BUCKET && String(env.COS_PRIVATE_BUCKET).trim() || (environment === 'production' ? '' : legacyCosBucket);
  if (!cosPublicBucket) throw new Error('Missing required configuration: COS_PUBLIC_BUCKET');
  if (!cosPrivateBucket) throw new Error('Missing required configuration: COS_PRIVATE_BUCKET');
  if (environment === 'production' && cosPublicBucket === cosPrivateBucket) throw new Error('COS_PUBLIC_BUCKET and COS_PRIVATE_BUCKET must be distinct in production');
  const cosRegion = required(env, 'COS_REGION');
  const databaseSchema = required(env, 'DATABASE_SCHEMA');
  const snapshotSystemActorId = env.SNAPSHOT_SYSTEM_ACTOR_ID && String(env.SNAPSHOT_SYSTEM_ACTOR_ID).trim();
  if (snapshotSystemActorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshotSystemActorId)) throw new Error('Invalid SNAPSHOT_SYSTEM_ACTOR_ID');
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
    cosPublicBucket,
    cosPrivateBucket,
    cosRegion,
    databaseSchema,
    snapshotSystemActorId,
    sessionCookieDomain: sessionCookieDomain || undefined,
    sessionHashPepper,
    authHashPepper,
    rateLimitPepper,
    bodyLimitBytes,
    csrfRequired: env.CSRF_REQUIRED !== 'false',
    trustedProxyHeaders: env.TRUST_PROXY_HEADERS === 'true',
    gatewayPath: env.API_GATEWAY_PATH || '/api/v1',
  };
}

module.exports = { parseConfig };
