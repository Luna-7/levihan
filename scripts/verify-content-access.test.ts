import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateContentAccess } from './verify-content-access.mjs';

const root = resolve(import.meta.dirname, '..');
const files = () => ({
  migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access.sql'), 'utf8'),
  rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access_rollback.sql'), 'utf8'),
  access: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access_runtime_access.sql'), 'utf8'),
  accessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access_runtime_access_rollback.sql'), 'utf8'),
  cosSource: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/infrastructure/cos.js'), 'utf8'),
  serviceSource: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/modules/access/service.js'), 'utf8'),
  swSource: readFileSync(resolve(root, 'vite.config.ts'), 'utf8'),
});

describe('content access schema verifier', () => {
  it('accepts the access migration and runtime boundary', () => expect(validateContentAccess(files())).toEqual([]));

  it.each([
    ['definer pinning', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('SET search_path = pg_catalog, public', ''); }],
    ['private asset filter', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("asset.storage_zone='private'", "asset.storage_zone='public'"); }],
    ['protected prefix', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("starts_with(asset.object_key,'protected/works/'||work.id::text||'/')", 'true'); }],
    ['final authorization check', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('CREATE FUNCTION public.finalize_work_access', 'CREATE FUNCTION public.finalize_work_access_removed'); }],
    ['work lock', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace(/FOR SHARE;/g, ';'); }],
    ['preview-only public derivative', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("asset.kind='preview'", "asset.kind IN ('cover','preview')"); }],
    ['direct consent DML revoke', (value: ReturnType<typeof files>) => { value.access = value.access.replace('REVOKE INSERT,UPDATE,DELETE ON TABLE public.age_consents', 'REVOKE SELECT ON TABLE public.age_consents'); }],
    ['five minute signing', (value: ReturnType<typeof files>) => { value.cosSource = value.cosSource.replace('expiresInSeconds !== 300', 'expiresInSeconds !== 600'); }],
    ['no-store response', (value: ReturnType<typeof files>) => { value.serviceSource = value.serviceSource.replace('private, no-store, max-age=0', 'private, max-age=300'); }],
    ['network only', (value: ReturnType<typeof files>) => { value.swSource = value.swSource.replace("handler: 'NetworkOnly'", "handler: 'CacheFirst'"); }],
    ['access response POST rule', (value: ReturnType<typeof files>) => { value.swSource = value.swSource.replace("method: 'POST'", "method: 'GET'"); }],
  ])('rejects mutation: %s', (_name, mutate) => {
    const value = files(); mutate(value); expect(validateContentAccess(value).length).toBeGreaterThan(0);
  });
});
