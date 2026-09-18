#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export function validateCosConfiguration(config, allowedOrigins) {
  const failures = [];
  if (!config || config.privatePublicGrant === true) failures.push('private bucket has a public grant');
  if (!config || config.publicBucketPublicGrant === true) failures.push('public bucket ACL permits anonymous bucket listing');
  if (config?.privateWebsiteEnabled !== false) failures.push('private bucket static website must be disabled');
  if (config?.publicWebsiteEnabled !== false) failures.push('public bucket static website must be disabled');
  for (const [label, cors] of [['private', config?.privateCors], ['public', config?.publicCors]]) {
    const origins = new Set(cors?.origins || []);
    if (!allowedOrigins.length || origins.has('*') || origins.size !== allowedOrigins.length || allowedOrigins.some((origin) => !origins.has(origin))) failures.push(`${label} CORS origins are not exact`);
    const methods = new Set(cors?.methods || []);
    if (!['GET','POST','PUT'].every((method) => methods.has(method))) failures.push(`${label} CORS must allow GET, POST, and PUT`);
    const headers = new Set((cors?.headers || []).map((value) => value.toLowerCase()));
    if (!headers.has('content-type') || !headers.has('x-cos-meta-sha256')) failures.push(`${label} CORS required headers are missing`);
  }
  if (!config?.stagingLifecycle || config.stagingLifecycle.prefix !== 'staging/' || config.stagingLifecycle.expirationDays > 1 || config.stagingLifecycle.expirationDays < 1) failures.push('staging lifecycle must expire at one day');
  const expectedResources = ['media/works/*', 'snapshots/public/*'];
  const policy = config?.publicPolicy;
  if (!policy || policy.anonymousDenyCount !== 0 || policy.conditionalAllowCount !== 0 || JSON.stringify([...(policy.anonymousActions || [])].sort()) !== JSON.stringify(['name/cos:GetObject']) || JSON.stringify([...(policy.anonymousResources || [])].sort()) !== JSON.stringify(expectedResources) || JSON.stringify([...(policy.allowedGetObjectPrefixes || [])].sort()) !== JSON.stringify(expectedResources)) failures.push('public bucket policy is not least privilege');
  return failures;
}

async function main() {
  try {
    const adapterPath = process.argv.find((value) => value.startsWith('--adapter='))?.slice(10);
    const environment = process.argv.find((value) => value.startsWith('--environment='))?.slice(14);
    const origins = (process.env.API_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (!adapterPath || !['nonprod','prod'].includes(environment)) throw new Error('adapter and environment are required');
    const module = await import(pathToFileURL(adapterPath).href);
    const adapter = await module.createMigrationAdapter({ environment });
    const failures = validateCosConfiguration(await adapter.readCosConfiguration(), origins);
    if (failures.length) throw new Error(failures.join('; '));
    process.stdout.write('COS backend-v2 configuration verified\n');
  } catch (error) { process.stderr.write(`COS backend-v2 verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
