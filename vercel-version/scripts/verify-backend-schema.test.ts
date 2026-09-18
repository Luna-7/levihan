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
      ['username regex', 'migration', (sql: string) => sql.replace("username ~ '^[a-z0-9_]{3,32}$'", 'false')],
      ['rate limit RPC', 'migration', (sql: string) => sql.replace('CREATE FUNCTION public.consume_rate_limit_bucket(', '-- CREATE FUNCTION public.consume_rate_limit_bucket(')],
      ['session resolver RPC', 'migration', (sql: string) => sql.replace('CREATE FUNCTION public.resolve_user_session(', '-- CREATE FUNCTION public.resolve_user_session(')],
      ['session resolver PUBLIC revoke', 'migration', (sql: string) => sql.replace('REVOKE EXECUTE ON FUNCTION public.resolve_user_session(text) FROM PUBLIC;', '-- REVOKE EXECUTE ON FUNCTION public.resolve_user_session(text) FROM PUBLIC;')],
      ['session resolver runtime grant', 'runtime', (sql: string) => sql.replace('public.resolve_user_session(text)', 'public.missing_resolve_user_session(text)')],
      ['session resolver rollback', 'rollback', (sql: string) => sql.replace('DROP FUNCTION IF EXISTS public.resolve_user_session(text);', '-- DROP FUNCTION IF EXISTS public.resolve_user_session(text);')],
      ['question options', 'migration', (sql: string) => sql.replace('options jsonb NOT NULL', 'options text NOT NULL')],
      ['session revoker RPC', 'migration', (sql: string) => sql.replace('CREATE FUNCTION public.revoke_user_session(', '-- CREATE FUNCTION public.revoke_user_session(')],
      ['session revoker runtime grant', 'runtime', (sql: string) => sql.replace('public.revoke_user_session(text)', 'public.missing_revoke_user_session(text)')],
      ['session revoker rollback', 'rollback', (sql: string) => sql.replace('DROP FUNCTION IF EXISTS public.revoke_user_session(text);', '-- DROP FUNCTION IF EXISTS public.revoke_user_session(text);')],
      ['idempotency table', 'migration', (sql: string) => sql.replace('CREATE TABLE public.idempotency_records', '-- CREATE TABLE public.idempotency_records')],
      ['idempotency unique key', 'migration', (sql: string) => sql.replace('PRIMARY KEY (scope, actor_scope_hash, idempotency_key)', 'PRIMARY KEY (scope, actor_scope_hash, request_hash)')],
      ['idempotency jsonb response', 'migration', (sql: string) => sql.replace('response jsonb', 'response text')],
      ['idempotency RLS', 'migration', (sql: string) => sql.replace('ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;', '-- ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;')],
      ['idempotency PUBLIC revoke', 'migration', (sql: string) => sql.replace(', public.idempotency_records FROM PUBLIC;', ' FROM PUBLIC;')],
      ['idempotency runtime grant', 'runtime', (sql: string) => sql.replace('public.begin_idempotent_request(text, text, text, text)', 'public.missing_begin_idempotent_request(text, text, text, text)')],
      ['idempotency direct table grant', 'runtime', (sql: string) => sql.replace('\nCOMMIT;', '\nGRANT SELECT ON TABLE public.idempotency_records TO :"backend_role";\nCOMMIT;')],
      ['idempotency rollback', 'rollback', (sql: string) => sql.replace('DROP FUNCTION IF EXISTS public.complete_idempotent_request(text,text,text,text,jsonb);', '-- DROP FUNCTION IF EXISTS public.complete_idempotent_request(text,text,text,text,jsonb);')],
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

  it('rejects mutations to every critical idempotency transition condition', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const mutations = [
      ['begin insert', (sql: string) => sql.replace('INSERT INTO public.idempotency_records', 'INSERT INTO public.missing_idempotency_records')],
      ['begin processing insert', (sql: string) => sql.replace("p_request_hash, 'processing', NULL, v_now + interval '5 minutes'", "p_request_hash, 'completed', NULL, v_now + interval '5 minutes'")],
      ['begin conflict target', (sql: string) => sql.replace('ON CONFLICT(scope,actor_scope_hash,idempotency_key)', 'ON CONFLICT(scope,actor_scope_hash,request_hash)')],
      ['begin expiry takeover', (sql: string) => sql.replace('WHERE idempotency_records.expires_at <= v_now', 'WHERE false')],
      ['begin hash conflict', (sql: string) => sql.replace("request_hash <> p_request_hash THEN 'request_hash_conflict'", "false THEN 'request_hash_conflict'")],
      ['begin completed replay', (sql: string) => sql.replace("status = 'completed' THEN 'completed'", "false THEN 'completed'")],
      ['complete update', (sql: string) => sql.replace('UPDATE public.idempotency_records', 'UPDATE public.missing_idempotency_records')],
      ['complete request hash', (sql: string) => sql.replace('AND request_hash = p_request_hash', 'AND true')],
      ['complete processing state', (sql: string) => sql.replace("AND status = 'processing'", 'AND true')],
      ['fail delete', (sql: string) => sql.replace('DELETE FROM public.idempotency_records', 'DELETE FROM public.missing_idempotency_records')],
      ['fail request hash', (sql: string) => sql.replaceAll('AND request_hash = p_request_hash', 'AND true')],
      ['fail processing state', (sql: string) => sql.replaceAll("AND status = 'processing'", 'AND true')],
    ] as const;

    for (const [name, mutate] of mutations) {
      const failures = validateBackendSchema({ migration: mutate(migration), rollback, runtimeAccess });
      expect(failures.length, name).toBeGreaterThan(0);
      expect(failures.some((failure) => failure.toLowerCase().includes('idempoten')), name).toBe(true);
    }
  });

  it('requires the rate-limit upsert to increment through its INSERT alias', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const corrected = migration.replace('rate_limit_buckets.hit_count + 1', 'current_bucket.hit_count + 1');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');

    expect(validateBackendSchema({ migration: corrected, rollback, runtimeAccess })).toEqual([]);
    expect(validateBackendSchema({
      migration: corrected.replace('current_bucket.hit_count + 1', 'rate_limit_buckets.hit_count + 1'),
      rollback,
      runtimeAccess,
    })).toContain('rate-limit consumer must increment through the current_bucket alias');
  });

  it('rejects session resolver mutations that weaken active-session checks', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const mutations = [
      ['token hash', (sql: string) => sql.replace('session.token_hash = p_token_hash', 'true')],
      ['revocation', (sql: string) => sql.replace('session.revoked_at IS NULL', 'true')],
      ['expiry', (sql: string) => sql.replace('session.expires_at > clock_timestamp()', 'true')],
      ['active user', (sql: string) => sql.replace("app_user.status = 'active'", 'true')],
      ['user join', (sql: string) => sql.replace('app_user.id = session.user_id', 'true')],
    ] as const;

    for (const [name, mutate] of mutations) {
      const failures = validateBackendSchema({ migration: mutate(migration), rollback, runtimeAccess });
      expect(failures.some((failure) => failure.toLowerCase().includes('session resolver')), name).toBe(true);
    }
  });

  it('requires a five-minute processing lease and extends only completed records to 24 hours', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const desired = migration;
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');

    expect(validateBackendSchema({ migration: desired, rollback, runtimeAccess })).toEqual([]);
    expect(validateBackendSchema({ migration: desired.replace("v_now + interval '5 minutes'", "v_now + interval '24 hours'"), rollback, runtimeAccess }))
      .toContain('idempotency processing lease must be five minutes');
    expect(validateBackendSchema({ migration: desired.replace(", expires_at = clock_timestamp() + interval '24 hours'", ''), rollback, runtimeAccess }))
      .toContain('idempotency completion must extend replay retention to 24 hours');
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

  it('requires controlled login, recovery rotation, and admin promotion workflows', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const failures = validateBackendSchema({
      migration,
      rollback: readFileSync(rollbackPath, 'utf8'),
      runtimeAccess,
    });
    expect(migration).toContain('CREATE FUNCTION public.create_login_session');
    expect(migration).toContain('CREATE FUNCTION public.regenerate_unconfirmed_recovery_code');
    expect(runtimeAccess).toContain('public.create_login_session(uuid, text, text, text)');
    expect(runtimeAccess).toContain('public.regenerate_unconfirmed_recovery_code(text,text,text,text)');
    expect(failures).toEqual([]);
  });

  it('rejects a recovery-code consumer mutation that removes used_at', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const start = migration.indexOf('CREATE FUNCTION public.consume_recovery_code');
    const end = migration.indexOf('CREATE FUNCTION public.set_work_like', start);
    const mutated = `${migration.slice(0, start)}${migration.slice(start, end).replace('SET used_at = clock_timestamp()', 'SET used_at = NULL')}${migration.slice(end)}`;
    const failures = validateBackendSchema({
      migration: mutated,
      rollback: readFileSync(rollbackPath, 'utf8'),
      runtimeAccess: readFileSync(runtimeAccessPath, 'utf8'),
    });
    expect(failures).toContain('recovery code must atomically mark used_at');
  });

  it('requires every v2 table in the PUBLIC table revoke set', () => {
    const migration = readFileSync(migrationPath, 'utf8').replace('public.moderation_actions, public.audit_logs,', 'public.moderation_actions,');
    const failures = validateBackendSchema({
      migration,
      rollback: readFileSync(rollbackPath, 'utf8'),
      runtimeAccess: readFileSync(runtimeAccessPath, 'utf8'),
    });
    expect(failures).toContain('PUBLIC table permissions must be revoked for audit_logs');
  });

  it('rejects password and role column grants on app_users', () => {
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8').replace(
      'GRANT UPDATE (username, status, last_login_at)',
      'GRANT UPDATE (username, status, last_login_at) ON TABLE public.app_users TO :"backend_role";\nGRANT UPDATE (password_hash, role)',
    );
    const failures = validateBackendSchema({
      migration: readFileSync(migrationPath, 'utf8'),
      rollback: readFileSync(rollbackPath, 'utf8'),
      runtimeAccess,
    });
    expect(failures).toContain('app_users update columns must not include password_hash or role');
  });

  it('rejects every prohibited table-level app_users grant form', () => {
    const cases = [
      ['UPDATE', 'ON TABLE', 'public.app_users', 'UPDATE'],
      ['INSERT', 'ON TABLE', 'public.app_users', 'INSERT'],
      ['DELETE', 'ON TABLE', 'public.app_users', 'DELETE'],
      ['TRUNCATE', 'ON TABLE', 'public.app_users', 'TRUNCATE'],
      ['REFERENCES', 'ON TABLE', 'public.app_users', 'REFERENCES'],
      ['TRIGGER', 'ON TABLE', 'public.app_users', 'TRIGGER'],
      ['ALL', 'ON TABLE', 'public.app_users', 'ALL'],
      ['ALL PRIVILEGES', 'ON TABLE', 'public.app_users', 'ALL'],
      ['UPDATE', 'ON', 'public.app_users', 'UPDATE'],
      ['INSERT', 'ON TABLE', 'public."app_users"', 'INSERT'],
      ['TRIGGER', 'ON TABLE', '"public"."app_users"', 'TRIGGER'],
    ] as const;

    for (const [privilege, onClause, table, expectedPrivilege] of cases) {
      const failures = validateBackendSchema({
        migration: readFileSync(migrationPath, 'utf8'),
        rollback: readFileSync(rollbackPath, 'utf8'),
        runtimeAccess: `${readFileSync(runtimeAccessPath, 'utf8')}\nGRANT ${privilege} ${onClause} ${table} TO :"backend_role";`,
      });
      expect(failures, `${privilege} ${onClause} ${table}`).toContain(`app_users must not receive table-level ${expectedPrivilege} privileges`);
    }
  });

  it('allows app_users SELECT and exact column UPDATE grants with or without TABLE', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const variants = [
      runtimeAccess,
      runtimeAccess.replace('GRANT SELECT ON TABLE public.app_users, public.user_sessions,', 'GRANT SELECT ON public.app_users, public.user_sessions,'),
      runtimeAccess.replace('GRANT UPDATE (username, status, last_login_at) ON TABLE public.app_users', 'GRANT UPDATE (username, status, last_login_at) ON public.app_users'),
    ];
    for (const variant of variants) {
      expect(validateBackendSchema({ migration, rollback, runtimeAccess: variant })).toEqual([]);
    }
  });

  it('requires direct question-bank CRUD with matching policies', () => {
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    expect(runtimeAccess).toContain('GRANT INSERT ON TABLE public.question_bank');
    expect(runtimeAccess).toContain('GRANT UPDATE ON TABLE public.question_bank');
    expect(runtimeAccess).toContain('GRANT DELETE ON TABLE public.question_bank');
    expect(runtimeAccess).toContain('backend_v2_runtime_insert ON public.question_bank');
    expect(runtimeAccess).toContain('backend_v2_runtime_update ON public.question_bank');
    expect(runtimeAccess).toContain('backend_v2_runtime_delete ON public.question_bank');
  });

  it('enforces the auth lifecycle guarantees in SQL and deployment scripts', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const ticketStart = migration.indexOf('CREATE FUNCTION public.consume_registration_ticket');
    const ticketEnd = migration.indexOf('CREATE FUNCTION public.create_login_session', ticketStart);
    const ticketConsumer = migration.slice(ticketStart, ticketEnd);
    const answerStart = migration.indexOf('CREATE FUNCTION public.answer_registration_challenge');
    const answerEnd = migration.indexOf('CREATE FUNCTION public.backend_v2_validate_submission_asset', answerStart);
    const challengeAnswer = migration.slice(answerStart, answerEnd);

    expect(ticketConsumer).not.toContain('challenge.expires_at > clock_timestamp()');
    expect(ticketConsumer).toContain("'registration-success'");
    expect(ticketConsumer).toContain('ON CONFLICT (subject_hash, bucket, window_started_at) DO UPDATE');
    expect(ticketConsumer).toContain('registration_success_rate_limited');
    expect(migration).toContain('recovery_confirmed_at timestamptz');
    expect(migration).toContain('question_versions integer[] NOT NULL');
    expect(migration).toContain('cardinality(question_versions) = cardinality(question_ids)');
    expect(challengeAnswer).toContain('question_versions');
    expect(challengeAnswer).toContain('public.question_bank');
    expect(migration).toContain('CREATE FUNCTION public.confirm_recovery_session');
    expect(migration).toContain('session.recovery_confirmed_at IS NOT NULL');
    expect(migration.slice(migration.indexOf('CREATE FUNCTION public.create_login_session'), migration.indexOf('CREATE FUNCTION public.rotate_user_session')))
      .toContain('p_current_token_hash');
    expect(runtimeAccess).toContain('public.confirm_recovery_session(text, text)');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.confirm_recovery_session(text, text);');
  });

  it('detects mutations to recovery confirmation, login rotation, question versions, and success-only limits', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const mutations = [
      ['confirmed resolver', (sql: string) => sql.replace('session.recovery_confirmed_at IS NOT NULL', 'true')],
      ['login current-token revoke', (sql: string) => sql.replace('token_hash = p_current_token_hash', 'false')],
      ['question version snapshot', (sql: string) => sql.replace('cardinality(question_versions) = cardinality(question_ids)', 'true')],
      ['question version answer guard', (sql: string) => sql.replace('question.version <> selected.question_version', 'false')],
      ['registration success bucket', (sql: string) => sql.replace("'registration-success'", "'registration-attempt'")],
      ['recovery confirmation code ownership', (sql: string) => sql.replace('recovery.user_id = session.user_id', 'true')],
      ['recovery code remains reusable', (sql: string) => sql.replace('recovery.used_at IS NULL', 'true')],
    ] as const;

    for (const [name, mutate] of mutations) {
      const failures = validateBackendSchema({ migration: mutate(migration), rollback, runtimeAccess });
      expect(failures.length, name).toBeGreaterThan(0);
      expect(failures.some((failure) => /session|recovery|question|registration/i.test(failure)), name).toBe(true);
    }
  });

  it('binds recovery confirmation to the account and keeps ticket preflight separate from atomic consumption', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const appUsersStart = migration.indexOf('CREATE TABLE public.app_users');
    const appUsersEnd = migration.indexOf('CREATE UNIQUE INDEX app_users_username_lower_key', appUsersStart);
    const appUsers = migration.slice(appUsersStart, appUsersEnd);
    const loginStart = migration.indexOf('CREATE FUNCTION public.create_login_session');
    const loginEnd = migration.indexOf('CREATE FUNCTION public.rotate_user_session', loginStart);
    const login = migration.slice(loginStart, loginEnd);
    const recoveryStart = migration.indexOf('CREATE FUNCTION public.consume_recovery_code');
    const recoveryEnd = migration.indexOf('CREATE FUNCTION public.confirm_recovery_session', recoveryStart);
    const recovery = migration.slice(recoveryStart, recoveryEnd);
    const confirmationStart = migration.indexOf('CREATE FUNCTION public.confirm_recovery_session');
    const confirmationEnd = migration.indexOf('CREATE FUNCTION public.set_work_like', confirmationStart);
    const confirmation = migration.slice(confirmationStart, confirmationEnd);

    expect(appUsers).toContain('recovery_confirmed_at timestamptz');
    expect(login).toContain('login_user.recovery_confirmed_at IS NOT NULL');
    expect(recovery).toContain('recovery_confirmed_at = NULL');
    expect(confirmation).toContain('UPDATE public.app_users');
    expect(confirmation).toContain('SET recovery_confirmed_at = v_now');
    expect(migration).toContain('app_user.recovery_confirmed_at IS NOT NULL');
    expect(migration).toContain('CREATE FUNCTION public.validate_registration_ticket');
    expect(runtimeAccess).toContain('public.validate_registration_ticket(text)');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.validate_registration_ticket(text);');
  });

  it('serializes login with recovery so either recovery blocks the old login or revokes its completed session', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const loginStart = migration.indexOf('CREATE FUNCTION public.create_login_session');
    const loginEnd = migration.indexOf('CREATE FUNCTION public.rotate_user_session', loginStart);
    const login = migration.slice(loginStart, loginEnd);
    const recoveryStart = migration.indexOf('CREATE FUNCTION public.consume_recovery_code');
    const recoveryEnd = migration.indexOf('CREATE FUNCTION public.confirm_recovery_session', recoveryStart);
    const recovery = migration.slice(recoveryStart, recoveryEnd);

    expect(login).toMatch(/SELECT login_user\.role INTO v_role FROM public\.app_users AS login_user[\s\S]*?FOR NO KEY UPDATE;[\s\S]*?INSERT INTO public\.user_sessions/);
    expect(recovery).toMatch(/UPDATE public\.app_users[\s\S]*?recovery_confirmed_at = NULL[\s\S]*?UPDATE public\.user_sessions SET revoked_at = clock_timestamp\(\)/);
  });

  it('detects account-confirmation and ticket-preflight security mutations', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');
    const runtimeAccess = readFileSync(runtimeAccessPath, 'utf8');
    const mutateRoutine = (sql: string, name: string, nextName: string, mutate: (routine: string) => string) => {
      const start = sql.indexOf(`CREATE FUNCTION public.${name}`);
      const end = sql.indexOf(`CREATE FUNCTION public.${nextName}`, start);
      return `${sql.slice(0, start)}${mutate(sql.slice(start, end))}${sql.slice(end)}`;
    };
    const mutations = [
      ['account resolver gate', (sql: string) => sql.replace('app_user.recovery_confirmed_at IS NOT NULL', 'true')],
      ['login account gate', (sql: string) => sql.replace('login_user.recovery_confirmed_at IS NOT NULL', 'true')],
      ['login/recovery row-lock serialization', (sql: string) => mutateRoutine(sql, 'create_login_session', 'rotate_user_session', (routine) => routine.replace('FOR NO KEY UPDATE', 'FOR KEY SHARE'))],
      ['recovery account reset', (sql: string) => sql.replace('recovery_confirmed_at = NULL', 'recovery_confirmed_at = clock_timestamp()')],
      ['confirmation account update', (sql: string) => mutateRoutine(sql, 'confirm_recovery_session', 'set_work_like', (routine) => routine.replace('UPDATE public.app_users', 'UPDATE public.missing_app_users'))],
      ['preflight unused ticket', (sql: string) => mutateRoutine(sql, 'validate_registration_ticket', 'consume_registration_ticket', (routine) => routine.replace('ticket.used_at IS NULL', 'true'))],
      ['preflight ticket expiry', (sql: string) => mutateRoutine(sql, 'validate_registration_ticket', 'consume_registration_ticket', (routine) => routine.replace('ticket.expires_at > clock_timestamp()', 'true'))],
      ['preflight passed challenge', (sql: string) => mutateRoutine(sql, 'validate_registration_ticket', 'consume_registration_ticket', (routine) => routine.replace("challenge.status = 'passed'", 'true'))],
    ] as const;

    for (const [name, mutate] of mutations) {
      const failures = validateBackendSchema({ migration: mutate(migration), rollback, runtimeAccess });
      expect(failures.length, name).toBeGreaterThan(0);
      expect(failures.some((failure) => /session|recovery|login|ticket/i.test(failure)), name).toBe(true);
    }
  });
});
