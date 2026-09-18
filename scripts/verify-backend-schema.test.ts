import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripSqlComments, validateBackendSchema } from './verify-backend-schema.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const migrationPath = resolve(repositoryRoot, 'cloudbase/migrations/20260918_backend_v2.sql');
const rollbackPath = resolve(repositoryRoot, 'cloudbase/migrations/20260918_backend_v2_rollback.sql');
const runtimeAccessPath = resolve(repositoryRoot, 'cloudbase/migrations/20260918_backend_v2_runtime_access.sql');
const verifierPath = resolve(repositoryRoot, 'scripts/verify-backend-schema.mjs');

describe('backend v2 PostgreSQL migration', () => {
  it('statically validates the additive schema, security controls, and atomic routines', () => {
    expect(existsSync(migrationPath), 'the v2 additive migration must exist').toBe(true);
    expect(existsSync(verifierPath), 'the schema verifier must exist').toBe(true);

    const verification = spawnSync(process.execPath, [verifierPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(verification.status, verification.stderr || verification.stdout).toBe(0);
    expect(verification.stdout).toContain('backend v2 schema static verification passed');
  });

  it('rejects structural mutations even if the removed SQL is retained in a comment', () => {
    const temporaryDirectory = mkdtempSync('/tmp/backend-v2-schema-');
    const mutatedMigration = resolve(temporaryDirectory, 'migration.sql');
    const mutatedRollback = resolve(temporaryDirectory, 'rollback.sql');
    const mutatedRuntimeAccess = resolve(temporaryDirectory, 'runtime-access.sql');
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const mutations = [
      ['atomic ticket consumer', 'migration', (sql: string) => sql.replace('CREATE FUNCTION public.consume_registration_ticket(', '-- CREATE FUNCTION public.consume_registration_ticket(')],
      ['transaction boundary', 'migration', (sql: string) => sql.replace(/^BEGIN;\n/m, '')],
      ['submission asset uniqueness', 'migration', (sql: string) => sql.replace('  UNIQUE (upload_file_id)\n', '')],
      ['comment depth guard', 'migration', (sql: string) => sql.replace('v_parent_parent_id IS NOT NULL', 'false')],
      ['runtime role grant', 'runtime', (sql: string) => sql.replace('public.works,\n', '')],
      ['runtime policy', 'runtime', (sql: string) => sql.replace('CREATE POLICY backend_v2_runtime_select ON public.comments', '-- CREATE POLICY backend_v2_runtime_select ON public.comments')],
      ['rollback trigger function', 'rollback', (sql: string) => sql.replace('DROP FUNCTION IF EXISTS public.backend_v2_set_updated_at();', '-- DROP FUNCTION IF EXISTS public.backend_v2_set_updated_at();')],
      ['username regex', 'migration', (sql: string) => sql.replace("username ~ '^[A-Za-z0-9_]{3,32}$'", 'false')],
    ] as const;

    try {
      for (const [name, artifact, mutate] of mutations) {
        writeFileSync(mutatedMigration, artifact === 'migration' ? mutate(migration) : migration);
        writeFileSync(mutatedRollback, artifact === 'rollback' ? mutate(rollback) : rollback);
        writeFileSync(mutatedRuntimeAccess, artifact === 'runtime' ? mutate(runtimeAccess) : runtimeAccess);
        const verification = spawnSync(process.execPath, [verifierPath], {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            BACKEND_V2_MIGRATION_PATH: mutatedMigration,
            BACKEND_V2_ROLLBACK_PATH: mutatedRollback,
            BACKEND_V2_RUNTIME_ACCESS_PATH: mutatedRuntimeAccess,
          },
        });

        expect(verification.status, `${name}: ${verification.stdout || verification.stderr}`).not.toBe(0);
        expect(verification.stderr, name).toContain('backend v2 schema static verification failed');
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('exports string-based validation for mutation tests', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    expect(validateBackendSchema({ migration, rollback, runtimeAccess })).toEqual([]);
    expect(validateBackendSchema({
      migration: migration.replace('BEGIN;\n', ''),
      rollback,
      runtimeAccess,
    })).toContain('migration must start with BEGIN;');
  });

  it('strips comments inside dollar-quoted bodies while preserving string literals', () => {
    const sql = "CREATE FUNCTION public.example() RETURNS void LANGUAGE plpgsql AS $$ BEGIN -- hidden\n/* also hidden */ PERFORM '-- literal', '/* literal */'; END $$;";
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toContain('hidden');
    expect(stripped).toContain("'-- literal'");
    expect(stripped).toContain("'/* literal */'");
  });

  it('rejects a challenge lock hidden inside a function-body comment', () => {
    const migration = readFileSync(migrationPath, 'utf8').replace('   FOR UPDATE;\n', '   -- FOR UPDATE;\n');
    const failures = validateBackendSchema({
      migration,
      rollback: readFileSync(rollbackPath, 'utf8'),
      runtimeAccess: readFileSync(runtimeAccessPath, 'utf8'),
    });
    expect(failures).toContain('challenge answer must lock one pending, unexpired challenge row');
  });

  it('rejects broad runtime CRUD and FOR ALL policies', () => {
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8')
      .replace('GRANT INSERT ON TABLE public.registration_challenges,', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.registration_challenges,')
      .replace('FOR SELECT TO :"backend_role" USING (true);', 'FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);');
    const failures = validateBackendSchema({
      migration: readFileSync(migrationPath, 'utf8'),
      rollback: readFileSync(rollbackPath, 'utf8'),
      runtimeAccess,
    });
    expect(failures).toContain('runtime role grants must be least privilege');
  });

  it('does not let generic uniqueness, upsert, or revoke checks mask a missing target', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const favoritesStart = migration.indexOf('CREATE TABLE public.favorites');
    const favoritesEnd = migration.indexOf('CREATE INDEX favorites_work_idx', favoritesStart);
    const withoutFavoriteKey = `${migration.slice(0, favoritesStart)}${migration.slice(favoritesStart, favoritesEnd).replace('  PRIMARY KEY (user_id, work_id)\n', '')}${migration.slice(favoritesEnd)}`;
    expect(validateBackendSchema({ migration: withoutFavoriteKey, rollback, runtimeAccess })).toContain('favorites must have user/work uniqueness');

    const favoriteFunctionStart = migration.indexOf('CREATE FUNCTION public.set_favorite');
    const favoriteFunctionEnd = migration.indexOf('CREATE FUNCTION public.sync_reading_progress', favoriteFunctionStart);
    const withoutFavoriteUpsert = `${migration.slice(0, favoriteFunctionStart)}${migration.slice(favoriteFunctionStart, favoriteFunctionEnd).replace('ON CONFLICT (user_id, work_id) DO NOTHING;', '')}${migration.slice(favoriteFunctionEnd)}`;
    expect(validateBackendSchema({ migration: withoutFavoriteUpsert, rollback, runtimeAccess })).toContain('favorite upsert must be idempotent');

    const withoutFavoriteRevoke = migration.replace('REVOKE EXECUTE ON FUNCTION public.set_favorite(uuid, uuid, boolean) FROM PUBLIC;\n', '');
    expect(validateBackendSchema({ migration: withoutFavoriteRevoke, rollback, runtimeAccess })).toContain('PUBLIC execute privilege must be revoked for set_favorite');
  });

  it('rejects deletion of immutable comment parent/work links', () => {
    const migration = readFileSync(migrationPath, 'utf8').replace(
      "  IF TG_OP = 'UPDATE'\n     AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN\n    RAISE EXCEPTION 'comment parent and work links are immutable' USING ERRCODE = '23514';\n  END IF;\n",
      '',
    );
    const failures = validateBackendSchema({
      migration,
      rollback: readFileSync(rollbackPath, 'utf8'),
      runtimeAccess: readFileSync(runtimeAccessPath, 'utf8'),
    });
    expect(failures).toContain('comment parent/work links must be immutable after insert');
  });
});
