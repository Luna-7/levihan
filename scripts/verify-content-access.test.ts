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
  pageSource: readFileSync(resolve(root, 'src/features/access/RestrictedWorkPage.tsx'), 'utf8'),
  routerSource: readFileSync(resolve(root, 'src/RootRouter.tsx'), 'utf8'),
  mainSource: readFileSync(resolve(root, 'src/main.tsx'), 'utf8'),
});

describe('content access schema verifier', () => {
  it('accepts the access migration and runtime boundary', () => expect(validateContentAccess(files())).toEqual([]));

  it.each([
    ['definer pinning', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('SET search_path = pg_catalog, public', ''); }],
    ['private asset filter', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("asset.storage_zone='private'", "asset.storage_zone='public'"); }],
    ['protected prefix', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("starts_with(asset.object_key,'protected/works/'||p_work_id::text||'/')", 'true'); }],
    ['final authorization check', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('CREATE FUNCTION public.finalize_work_access', 'CREATE FUNCTION public.finalize_work_access_removed'); }],
    ['work lock', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace(/FOR SHARE;/g, ';'); }],
    ['preview-only public derivative', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("asset.kind='preview'", "asset.kind IN ('cover','preview')"); }],
    ['direct consent DML revoke', (value: ReturnType<typeof files>) => { value.access = value.access.replace('REVOKE INSERT,UPDATE,DELETE ON TABLE public.age_consents', 'REVOKE SELECT ON TABLE public.age_consents'); }],
    ['five minute signing', (value: ReturnType<typeof files>) => { value.cosSource = value.cosSource.replace('expiresInSeconds !== 300', 'expiresInSeconds !== 600'); }],
    ['no-store response', (value: ReturnType<typeof files>) => { value.serviceSource = value.serviceSource.replace('private, no-store, max-age=0', 'private, max-age=300'); }],
    ['network only', (value: ReturnType<typeof files>) => { value.swSource = value.swSource.replace("handler: 'NetworkOnly'", "handler: 'CacheFirst'"); }],
    ['access response POST rule', (value: ReturnType<typeof files>) => { value.swSource = value.swSource.replace("method: 'POST'", "method: 'GET'"); }],
    ['session resolver', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('session.revoked_at IS NULL', 'true'); }],
    ['session binding', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('session_id uuid NOT NULL', 'session_id uuid'); }],
    ['session final recheck', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('session.revoked_at IS NOT NULL', 'false'); }],
    ['asset work version', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('work.version<>authorization.work_version', 'false'); }],
    ['asset hash compare', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('content_access_constant_time_equal(manifest_hash,authorization.asset_set_hash)', 'true'); }],
    ['constant time compare', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('FOR position IN 0..31 LOOP', 'IF true THEN'); }],
    ['persistent admin restriction', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('CREATE TABLE public.restricted_access_controls', 'CREATE TABLE public.removed_restricted_access_controls'); }],
    ['admin validation', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("admin.role<>'admin'", 'false'); }],
    ['admin pending invalidation', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace("UPDATE public.content_access_authorizations SET status='denied'\n     WHERE user_id=p_user_id", "UPDATE public.content_access_authorizations SET status='pending'\n     WHERE user_id=p_user_id"); }],
    ['COS query signature', (value: ReturnType<typeof files>) => { value.cosSource = value.cosSource.replace("parsed.searchParams.get('q-signature')", "parsed.searchParams.get('removed-signature')"); }],
    ['COS time window', (value: ReturnType<typeof files>) => { value.cosSource = value.cosSource.replace('end - start > 300', 'end - start > 600'); }],
    ['reader memory boundary', (value: ReturnType<typeof files>) => { value.pageSource += '\nlocalStorage.setItem("signed", "url");'; }],
    ['reader root route', (value: ReturnType<typeof files>) => { value.mainSource = value.mainSource.replace('<RootRouter />', '<div />'); }],
    ['authorization lock-order cleanup', (value: ReturnType<typeof files>) => { value.migration = value.migration.replace('manifest_hash text;\nBEGIN', "manifest_hash text;\nBEGIN\n  DELETE FROM public.content_access_authorizations WHERE expires_at < clock_timestamp();"); }],
  ])('rejects mutation: %s', (_name, mutate) => {
    const value = files(); mutate(value); expect(validateContentAccess(value).length).toBeGreaterThan(0);
  });
});
