import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migration = readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2.sql'), 'utf8');
const rollback = readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2_rollback.sql'), 'utf8');

const requiredTables = [
  'app_users', 'user_sessions', 'question_bank', 'registration_challenges',
  'registration_tickets', 'registration_attempts', 'recovery_codes', 'age_consents',
  'works', 'work_assets', 'tags', 'work_tags', 'work_versions', 'work_likes',
  'favorites', 'comments', 'reading_progress', 'reports', 'submissions',
  'submission_assets', 'upload_sessions', 'upload_files', 'snapshot_jobs',
  'snapshot_versions', 'moderation_actions', 'audit_logs', 'site_settings',
  'blocked_subjects', 'rate_limit_buckets',
];

const requiredFunctions = [
  'consume_registration_ticket',
  'rotate_user_session',
  'consume_recovery_code',
  'set_work_like',
  'set_favorite',
  'sync_reading_progress',
];

const failures = [];
const requireMatch = (condition, message) => {
  if (!condition) failures.push(message);
};
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

requireMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/i.test(migration), 'pgcrypto must provide UUID generation');
requireMatch(/DEFAULT\s+gen_random_uuid\(\)/i.test(migration), 'v2 tables must use pgcrypto UUID defaults');
requireMatch(/CREATE FUNCTION public\.backend_v2_set_updated_at\(\)/i.test(migration), 'updated_at trigger function is missing');
requireMatch(!/REFERENCES\s+public\.users\b/i.test(migration), 'v2 foreign keys must not target legacy public.users');
requireMatch(!/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.users\b/i.test(migration), 'migration must not alter or drop legacy public.users');
requireMatch(!/\bRENAME\s+(?:TABLE|TO)\b[^;]*\busers\b/i.test(migration), 'migration must not rename legacy users');
requireMatch(!/REVOKE ALL ON ALL TABLES IN SCHEMA public/i.test(migration), 'migration must not revoke legacy-table privileges');

for (const table of requiredTables) {
  const tableExpression = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${escapeRegExp(table)}\\b`, 'i');
  const rlsExpression = new RegExp(`ALTER TABLE public\\.${escapeRegExp(table)} ENABLE ROW LEVEL SECURITY`, 'i');
  const rollbackExpression = new RegExp(`DROP TABLE IF EXISTS public\\.${escapeRegExp(table)}\\s*;`, 'i');
  requireMatch(tableExpression.test(migration), `missing additive table: ${table}`);
  requireMatch(rlsExpression.test(migration), `RLS is not enabled for ${table}`);
  requireMatch(rollbackExpression.test(rollback), `rollback must drop v2 table ${table}`);
}

for (const fn of requiredFunctions) {
  const functionExpression = new RegExp(`CREATE FUNCTION public\\.${escapeRegExp(fn)}\\(`, 'i');
  const rollbackExpression = new RegExp(`DROP FUNCTION IF EXISTS public\\.${escapeRegExp(fn)}\\(`, 'i');
  requireMatch(functionExpression.test(migration), `missing atomic SQL routine: ${fn}`);
  requireMatch(rollbackExpression.test(rollback), `rollback must remove ${fn}`);
}

for (const table of ['app_users', 'works', 'work_assets', 'comments', 'submissions', 'upload_files', 'snapshot_jobs']) {
  requireMatch(
    new RegExp(`CREATE TRIGGER ${escapeRegExp(table)}_set_updated_at BEFORE UPDATE ON public\\.${escapeRegExp(table)}`, 'i').test(migration),
    `updated_at trigger is missing for ${table}`,
  );
}

requireMatch(/CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower_key ON public\.app_users \(lower\(username\)\)/i.test(migration), 'username must be unique after case normalization');
requireMatch(/CREATE INDEX IF NOT EXISTS works_public_directory_idx ON public\.works \(status, published_at DESC\)/i.test(migration), 'published work directory index is missing');
requireMatch(/CREATE INDEX IF NOT EXISTS comments_work_list_idx ON public\.comments \(work_id, status, created_at DESC\)/i.test(migration), 'comment list index is missing');
requireMatch(/CREATE INDEX IF NOT EXISTS submissions_queue_idx ON public\.submissions \(status, created_at\)/i.test(migration), 'submission queue index is missing');
requireMatch(/CREATE INDEX IF NOT EXISTS snapshot_jobs_queue_idx ON public\.snapshot_jobs \(status, created_at\)/i.test(migration), 'snapshot queue index is missing');
requireMatch(/(?:UNIQUE|PRIMARY KEY) \(user_id, work_id\)/i.test(migration), 'interaction and progress uniqueness is missing');
requireMatch(/token_hash text NOT NULL/i.test(migration), 'session token hashes are required');
requireMatch(/code_hash text NOT NULL/i.test(migration), 'recovery-code hashes are required');
requireMatch(/ON CONFLICT \(user_id, work_id\) DO NOTHING/i.test(migration), 'like/favorite upsert must be idempotent');
requireMatch(/ON CONFLICT \(user_id, work_id\) DO UPDATE/i.test(migration), 'reading-progress upsert must be idempotent');
requireMatch(/SET used_at = clock_timestamp\(\)/i.test(migration), 'ticket and recovery-code consumption must mark a used timestamp');
requireMatch(/REVOKE ALL ON TABLE public\.app_users/i.test(migration), 'PUBLIC table permissions must be revoked');
requireMatch(/REVOKE EXECUTE ON FUNCTION public\.consume_registration_ticket/i.test(migration), 'PUBLIC function execution must be revoked');
requireMatch(!/\bDROP TABLE\b[^;]*\bpublic\.users\b/i.test(rollback), 'rollback must not drop legacy public.users');
requireMatch(!/\bDROP EXTENSION\s+(?:IF EXISTS\s+)?pgcrypto\b/i.test(rollback), 'rollback must not remove a possibly pre-existing pgcrypto extension');

if (failures.length > 0) {
  console.error(`backend v2 schema static verification failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('backend v2 schema static verification passed');
}
