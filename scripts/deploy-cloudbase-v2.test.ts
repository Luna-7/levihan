import { describe, expect, it, vi } from 'vitest';
import { deployCloudBase, parseDeployOptions } from './deploy-cloudbase-v2.mjs';
describe('CloudBase deployment guard', () => {
  const env = { CLOUDBASE_PROD_ENV_ID: 'production-123', CLOUDBASE_NONPROD_ENV_ID: 'staging-123' };
  const deployEnv = { ...env, CLOUDBASE_APIKEY: 'fixture-api-key', COS_PUBLIC_BUCKET: 'public-123', COS_PRIVATE_BUCKET: 'private-123', COS_REGION: 'ap-shanghai', DATABASE_SCHEMA: 'backend_v2', API_ALLOWED_ORIGINS: 'https://app.example', SESSION_HASH_PEPPER: 's'.repeat(32), AUTH_HASH_PEPPER: 'a'.repeat(32), MIGRATION_HASH_PEPPER: 'm'.repeat(32), RATE_LIMIT_PEPPER: 'r'.repeat(32), SESSION_COOKIE_DOMAIN: '', SESSION_COOKIE_NAME: 'lv_session', CSRF_COOKIE_NAME: 'lv_csrf', MIGRATION_COOKIE_NAME: 'lv_migrate', API_BODY_LIMIT_BYTES: '1048576', CSRF_REQUIRED: 'true', TRUST_PROXY_HEADERS: 'true', API_PROXY_HMAC_SECRET: 'h'.repeat(32), LEGACY_MIGRATION_ENABLED: 'true', SNAPSHOT_SYSTEM_ACTOR_ID: '11111111-1111-4111-8111-111111111111' };
  const functionEnv = (name: string) => Object.fromEntries((name === 'app-api' ? ['CLOUDBASE_APIKEY','COS_PUBLIC_BUCKET','COS_PRIVATE_BUCKET','COS_REGION','DATABASE_SCHEMA','API_ALLOWED_ORIGINS','SESSION_HASH_PEPPER','AUTH_HASH_PEPPER','MIGRATION_HASH_PEPPER','RATE_LIMIT_PEPPER','SESSION_COOKIE_DOMAIN','SESSION_COOKIE_NAME','CSRF_COOKIE_NAME','MIGRATION_COOKIE_NAME','API_BODY_LIMIT_BYTES','CSRF_REQUIRED','TRUST_PROXY_HEADERS','API_PROXY_HMAC_SECRET','LEGACY_MIGRATION_ENABLED','SNAPSHOT_SYSTEM_ACTOR_ID'] : ['CLOUDBASE_APIKEY','COS_PUBLIC_BUCKET','COS_PRIVATE_BUCKET','COS_REGION','DATABASE_SCHEMA','API_ALLOWED_ORIGINS','SESSION_HASH_PEPPER','AUTH_HASH_PEPPER','RATE_LIMIT_PEPPER','SESSION_COOKIE_DOMAIN','SNAPSHOT_SYSTEM_ACTOR_ID']).map((key) => [key, deployEnv[key as keyof typeof deployEnv]]));
  const detail = (name: string, overrides: Record<string, unknown> = {}) => ({ name, type: name === 'app-api' ? 'HTTP' : 'Event', handler: name === 'app-api' ? 'index.main' : name === 'snapshot-worker' ? 'snapshot-worker.main' : 'upload-cleanup-worker.main', gatewayPath: '/api/v1', triggers: name === 'app-api' ? [] : [{ name: name === 'snapshot-worker' ? 'catalog-snapshot-every-5m' : 'upload-cleanup-every-10m' }], environmentVariables: functionEnv(name), ...overrides });
  it('requires an extra production confirmation based on trusted env-id mapping', () => {
    expect(() => parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=nonprod','--env-id=production-123'], env)).toThrow(/mapping/);
    expect(() => parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=prod','--env-id=production-123'], env)).toThrow(/production/);
  });
  it('pins and reads back every deployment against the explicit environment id', async () => {
    const runner = vi.fn(async (args: string[], options: { cwd: string; env: Record<string, string> }) => ({ stdout: JSON.stringify(detail(args[2])), options }));
    await deployCloudBase(parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=nonprod','--env-id=staging-123'], env), runner, deployEnv);
    expect(runner).toHaveBeenCalledTimes(6);
    expect(runner.mock.calls.every(([args, options]) => args.includes('--env-id') && args.includes('staging-123') && options.cwd.endsWith('/cloudbase') && options.env.CLOUDBASE_ENV_ID === 'staging-123')).toBe(true);
    expect(runner.mock.calls[0][0].slice(0, 3)).toEqual(['fn','deploy','app-api']);
    expect(runner.mock.calls[0][0]).toEqual(expect.arrayContaining(['--force', '--yes']));
  });

  it('rejects read-back text where expected values only appear in an unrelated field', async () => {
    const runner = vi.fn(async (args: string[]) => args[1] === 'deploy' ? { stdout: '' } : { stdout: JSON.stringify({
      name: args[2], type: 'HTTP', handler: 'wrong.main', gatewayPath: '/wrong', triggers: [], environmentVariables: {},
      description: 'index.main /api/v1 API_PROXY_HMAC_SECRET DATABASE_SCHEMA COS_PUBLIC_BUCKET COS_PRIVATE_BUCKET',
    }) });
    await expect(deployCloudBase(parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=nonprod','--env-id=staging-123'], env), runner, deployEnv)).rejects.toThrow(/read-back/);
  });

  it('rejects missing or false trusted proxy read-back and any extra trigger', async () => {
    for (const override of [
      { environmentVariables: { ...functionEnv('app-api'), TRUST_PROXY_HEADERS: undefined } },
      { environmentVariables: { ...functionEnv('app-api'), TRUST_PROXY_HEADERS: 'false' } },
      { triggers: [{ name: 'unexpected-timer' }] },
    ]) {
      const runner = vi.fn(async (args: string[]) => ({ stdout: JSON.stringify(detail(args[2], args[2] === 'app-api' ? override : {})) }));
      await expect(deployCloudBase(parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=nonprod','--env-id=staging-123'], env), runner, deployEnv)).rejects.toThrow(/read-back/);
    }
  });

  it('fails before invoking tcb when a required local deployment binding is empty', async () => {
    const runner = vi.fn();
    await expect(deployCloudBase(parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=nonprod','--env-id=staging-123'], env), runner, { ...deployEnv, API_PROXY_HMAC_SECRET: '' })).rejects.toThrow(/preflight/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('accepts a host-only cookie deployment when SESSION_COOKIE_DOMAIN is absent from read-back', async () => {
    const runner = vi.fn(async (args: string[]) => { const environmentVariables = functionEnv(args[2]); delete environmentVariables.SESSION_COOKIE_DOMAIN; return { stdout: JSON.stringify(detail(args[2], { environmentVariables })) }; });
    await expect(deployCloudBase(parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=nonprod','--env-id=staging-123'], env), runner, deployEnv)).resolves.toMatchObject({ environment: 'nonprod' });
  });

  it.each([
    ['invalid origin', { API_ALLOWED_ORIGINS: 'not-an-origin' }],
    ['same buckets', { COS_PRIVATE_BUCKET: 'public-123' }],
    ['invalid actor', { SNAPSHOT_SYSTEM_ACTOR_ID: 'not-a-uuid' }],
    ['invalid cookie', { SESSION_COOKIE_NAME: 'bad cookie' }],
    ['invalid optional domain', { SESSION_COOKIE_DOMAIN: 'not a domain' }],
  ])('rejects %s during local configuration preflight', async (_name, override) => {
    const runner = vi.fn();
    await expect(deployCloudBase(parseDeployOptions(['--apply=DEPLOY_BACKEND_V2','--environment=nonprod','--env-id=staging-123'], env), runner, { ...deployEnv, ...override })).rejects.toThrow(/preflight/);
    expect(runner).not.toHaveBeenCalled();
  });
});
