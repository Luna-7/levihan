#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { resolve } from 'node:path';
const execute = promisify(execFile);
const FUNCTIONS = ['app-api','snapshot-worker','upload-cleanup-worker'];

export function parseDeployOptions(argv, env = process.env) {
  const entries = argv.map((arg) => { if (!arg.startsWith('--') || !arg.includes('=')) throw new Error('deploy options must be explicit'); const [key, ...value] = arg.slice(2).split('='); return [key, value.join('=')]; });
  const flags = Object.fromEntries(entries);
  const prodId = env.CLOUDBASE_PROD_ENV_ID; const nonprodId = env.CLOUDBASE_NONPROD_ENV_ID; const target = flags['env-id'];
  if (entries.length !== Object.keys(flags).length || flags.apply !== 'DEPLOY_BACKEND_V2' || !['nonprod','prod'].includes(flags.environment) || !/^[a-zA-Z0-9-]{6,80}$/.test(target || '') || !prodId || !nonprodId || prodId === nonprodId) throw new Error('deployment acknowledgement and trusted environment mapping are required');
  const actualEnvironment = target === prodId ? 'prod' : target === nonprodId ? 'nonprod' : null;
  if (!actualEnvironment || actualEnvironment !== flags.environment) throw new Error('deployment target does not match the trusted environment mapping');
  if (actualEnvironment === 'prod' && flags['prod-confirm'] !== 'PRODUCTION_CLOUDBASE_DEPLOY') throw new Error('production deployment confirmation required');
  return { environment: actualEnvironment, envId: target };
}

const WORKER_BINDINGS = ['CLOUDBASE_APIKEY','COS_PUBLIC_BUCKET','COS_PRIVATE_BUCKET','COS_REGION','DATABASE_SCHEMA','API_ALLOWED_ORIGINS','SESSION_HASH_PEPPER','AUTH_HASH_PEPPER','RATE_LIMIT_PEPPER','SESSION_COOKIE_DOMAIN','SNAPSHOT_SYSTEM_ACTOR_ID'];
const APP_BINDINGS = ['CLOUDBASE_APIKEY','COS_PUBLIC_BUCKET','COS_PRIVATE_BUCKET','COS_REGION','DATABASE_SCHEMA','API_ALLOWED_ORIGINS','SESSION_HASH_PEPPER','AUTH_HASH_PEPPER','MIGRATION_HASH_PEPPER','RATE_LIMIT_PEPPER','SESSION_COOKIE_DOMAIN','SESSION_COOKIE_NAME','CSRF_COOKIE_NAME','MIGRATION_COOKIE_NAME','API_BODY_LIMIT_BYTES','CSRF_REQUIRED','TRUST_PROXY_HEADERS','API_PROXY_HMAC_SECRET','LEGACY_MIGRATION_ENABLED','SNAPSHOT_SYSTEM_ACTOR_ID'];
const EXPECTED = {
  'app-api': { type: 'HTTP', handler: 'index.main', gatewayPath: '/api/v1', triggers: [], bindings: APP_BINDINGS },
  'snapshot-worker': { type: 'Event', handler: 'snapshot-worker.main', triggers: ['catalog-snapshot-every-5m'], bindings: WORKER_BINDINGS },
  'upload-cleanup-worker': { type: 'Event', handler: 'upload-cleanup-worker.main', triggers: ['upload-cleanup-every-10m'], bindings: WORKER_BINDINGS },
};
const key = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function parsedDetail(text) {
  const clean = String(text).replace(/\u001b\[[0-9;]*m/g, '').trim();
  try { const value = JSON.parse(clean); if (value && typeof value === 'object') return value; } catch {}
  const result = {};
  for (const line of clean.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_. -]{1,80})\s*[:：]\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2];
  }
  if (!Object.keys(result).length) throw new Error('deployment detail is not structured');
  return result;
}
function findField(value, aliases) {
  if (!value || typeof value !== 'object') return undefined;
  for (const [name, item] of Object.entries(value)) if (aliases.includes(key(name))) return item;
  for (const item of Object.values(value)) { const found = findField(item, aliases); if (found !== undefined) return found; }
}
function tokens(value) {
  if (Array.isArray(value)) return value.flatMap(tokens);
  if (value && typeof value === 'object') return [...Object.keys(value), ...Object.values(value).flatMap(tokens)];
  return String(value ?? '').split(/[\s,;]+/).filter(Boolean);
}
const sameSet = (left, right) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
function triggerNames(value) {
  if (Array.isArray(value)) return value.flatMap(triggerNames);
  if (value && typeof value === 'object') { const name = value.name ?? value.triggerName; return typeof name === 'string' ? [name] : []; }
  return typeof value === 'string' ? tokens(value) : [];
}
export function validateFunctionDetail(text, name, deploymentEnv = {}) {
  const detail = parsedDetail(text); const expected = EXPECTED[name];
  const actualName = findField(detail, ['name','functionname']);
  const type = findField(detail, ['type','functiontype']);
  const handler = findField(detail, ['handler','entrypoint']);
  const gatewayPath = findField(detail, ['gatewaypath','httppath']);
  const triggers = triggerNames(findField(detail, ['triggers','triggerconfig','trigger']));
  const bindingsValue = findField(detail, ['environmentvariables','environment','env']);
  const bindings = bindingsValue && typeof bindingsValue === 'object' && !Array.isArray(bindingsValue) ? Object.keys(bindingsValue) : tokens(bindingsValue);
  const bindingObject = bindingsValue && typeof bindingsValue === 'object' && !Array.isArray(bindingsValue) ? bindingsValue : null;
  const hostOnlyCookie = !deploymentEnv.SESSION_COOKIE_DOMAIN;
  const requiredBindings = hostOnlyCookie ? expected.bindings.filter((item) => item !== 'SESSION_COOKIE_DOMAIN') : expected.bindings;
  const comparedBindings = hostOnlyCookie ? bindings.filter((item) => item !== 'SESSION_COOKIE_DOMAIN') : bindings;
  const cookieDomainValid = hostOnlyCookie ? (!bindings.includes('SESSION_COOKIE_DOMAIN') || bindingObject?.SESSION_COOKIE_DOMAIN === '') : bindingObject?.SESSION_COOKIE_DOMAIN === deploymentEnv.SESSION_COOKIE_DOMAIN;
  const trustedProxyEnabled = name !== 'app-api' || (bindingsValue && typeof bindingsValue === 'object' && !Array.isArray(bindingsValue) && bindingsValue.TRUST_PROXY_HEADERS === 'true');
  if (actualName !== name || type !== expected.type || handler !== expected.handler || (expected.gatewayPath && gatewayPath !== expected.gatewayPath) || !sameSet(triggers, expected.triggers) || !sameSet(comparedBindings, requiredBindings) || !cookieDomainValid || !trustedProxyEnabled) throw new Error(`deployment read-back failed for ${name}`);
}
function validateLocalBindings(env) {
  const required = APP_BINDINGS.filter((name) => name !== 'SESSION_COOKIE_DOMAIN');
  if (required.some((name) => typeof env[name] !== 'string' || !env[name].trim() || env[name].includes('{{'))) throw new Error('deployment environment preflight failed');
  let originsValid = false;
  try { const origins = env.API_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean); originsValid = origins.length > 0 && origins.every((value) => { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; }); } catch {}
  const cookieToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  const domain = env.SESSION_COOKIE_DOMAIN || '';
  const domainValid = !domain || /^\.?[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(domain);
  if (['SESSION_HASH_PEPPER','AUTH_HASH_PEPPER','MIGRATION_HASH_PEPPER','RATE_LIMIT_PEPPER','API_PROXY_HMAC_SECRET'].some((name) => env[name].length < 32)
    || env.TRUST_PROXY_HEADERS !== 'true' || env.CSRF_REQUIRED !== 'true' || !['true','false'].includes(env.LEGACY_MIGRATION_ENABLED)
    || !/^\d+$/.test(env.API_BODY_LIMIT_BYTES) || Number(env.API_BODY_LIMIT_BYTES) < 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.SNAPSHOT_SYSTEM_ACTOR_ID)
    || !originsValid || env.COS_PUBLIC_BUCKET === env.COS_PRIVATE_BUCKET || !domainValid
    || ![env.SESSION_COOKIE_NAME,env.CSRF_COOKIE_NAME,env.MIGRATION_COOKIE_NAME].every((value) => cookieToken.test(value))) throw new Error('deployment environment preflight failed');
}
export async function deployCloudBase(options, runner = async (args, commandOptions) => {
  const result = await execute('tcb', args, { timeout: 300_000, ...commandOptions });
  return { stdout: String(result.stdout) };
}, deploymentEnv = process.env) {
  validateLocalBindings(deploymentEnv);
  const cwd = resolve(import.meta.dirname, '..', 'cloudbase');
  const commandOptions = { cwd, env: { ...deploymentEnv, CLOUDBASE_ENV_ID: options.envId } };
  for (const name of FUNCTIONS) await runner(['fn', 'deploy', name, '--env-id', options.envId, '--force', '--yes'], commandOptions);
  for (const name of FUNCTIONS) {
    const result = await runner(['fn', 'detail', name, '--env-id', options.envId], commandOptions);
    validateFunctionDetail(String(result?.stdout || result || ''), name, deploymentEnv);
  }
  return { environment: options.environment, envId: options.envId, functions: FUNCTIONS };
}

async function main() { try { const result = await deployCloudBase(parseDeployOptions(process.argv.slice(2), process.env)); process.stdout.write(`CloudBase v2 deployed and read back: environment=${result.environment} functions=${result.functions.length}\n`); } catch (error) { process.stderr.write(`CloudBase deployment refused: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
