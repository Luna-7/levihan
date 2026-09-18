import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateContentPipeline } from './verify-content-pipeline.mjs';

const root = resolve(import.meta.dirname, '..');
const migration = readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline.sql'), 'utf8');
const rollback = readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_rollback.sql'), 'utf8');
const access = readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_runtime_access.sql'), 'utf8');

describe('content pipeline migration verifier', () => {
  it('accepts the reviewed additive migration set', () => {
    expect(validateContentPipeline({ migration, rollback, access })).toEqual([]);
  });

  it.each([
    ['admin authorization', (sql: string) => sql.replace("actor.role <> 'admin'", "actor.role <> 'member'")],
    ['optimistic lock', (sql: string) => sql.replace('work.version <> p_expected_version', 'work.version = p_expected_version')],
    ['upload ownership', (sql: string) => sql.replace('session.owner_id <> p_actor_id', 'session.owner_id = p_actor_id')],
    ['upload expiry', (sql: string) => sql.replace('session.expires_at <= clock_timestamp()', 'session.expires_at > clock_timestamp()')],
    ['asset verification', (sql: string) => sql.replace("asset.status <> 'verified'", "asset.status = 'verified'")],
    ['snapshot serialization', (sql: string) => sql.replace("pg_advisory_xact_lock(hashtext('snapshot:' || p_snapshot_type))", 'TRUE')],
  ])('rejects mutation removing %s', (_name, mutate) => {
    expect(validateContentPipeline({ migration: mutate(migration), rollback, access })).not.toEqual([]);
  });

  it('requires rollback and least-privilege runtime grants', () => {
    expect(validateContentPipeline({ migration, rollback: rollback.replace('DROP TABLE IF EXISTS public.work_chapters;', ''), access })).not.toEqual([]);
    expect(validateContentPipeline({ migration, rollback, access: access.replace('GRANT SELECT ON TABLE public.work_chapters', 'GRANT ALL ON TABLE public.work_chapters') })).not.toEqual([]);
  });
});
