import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export const REQUIRED_TABLES = [
  'app_users', 'user_sessions', 'question_bank', 'registration_challenges',
  'registration_attempts', 'registration_tickets', 'recovery_codes', 'age_consents',
  'works', 'work_assets', 'tags', 'work_tags', 'work_versions', 'work_likes',
  'favorites', 'comments', 'reading_progress', 'reports', 'upload_sessions',
  'upload_files', 'submissions', 'submission_assets', 'snapshot_jobs',
  'snapshot_versions', 'moderation_actions', 'audit_logs', 'site_settings',
  'blocked_subjects', 'rate_limit_buckets',
];

export const REQUIRED_FUNCTIONS = {
  backend_v2_set_updated_at: '',
  backend_v2_enforce_comment_reply_depth: '',
  backend_v2_validate_submission_asset: '',
  answer_registration_challenge: 'uuid, boolean, integer, integer, text, timestamptz',
  consume_registration_ticket: 'text, text, text, text, timestamptz, text',
  rotate_user_session: 'text, text, timestamptz, text',
  consume_recovery_code: 'text, text, text, timestamptz, text',
  set_work_like: 'uuid, uuid, boolean',
  set_favorite: 'uuid, uuid, boolean',
  sync_reading_progress: 'uuid, uuid, bigint, numeric, bigint, timestamptz',
};

const UPDATED_AT_TABLES = [
  'app_users', 'user_sessions', 'question_bank', 'registration_challenges', 'age_consents',
  'works', 'work_assets', 'tags', 'comments', 'reading_progress', 'reports',
  'upload_sessions', 'upload_files', 'submissions', 'snapshot_jobs', 'site_settings',
  'rate_limit_buckets',
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remove SQL comments without changing quoted strings or dollar-quoted bodies. */
export function stripSqlComments(source) {
  let result = '';
  let state = 'normal';
  let dollarTag = '';

  for (let index = 0; index < source.length;) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (character === '\n') {
        result += '\n';
        state = 'normal';
      }
      index += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        result += '  ';
        index += 2;
        state = 'normal';
      } else {
        result += character === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote') {
      result += character;
      if (character === "'" && next === "'") {
        result += next;
        index += 2;
      } else {
        if (character === "'") state = 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'double-quote') {
      result += character;
      if (character === '"' && next === '"') {
        result += next;
        index += 2;
      } else {
        if (character === '"') state = 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'dollar-quote') {
      if (source.startsWith(dollarTag, index)) {
        result += dollarTag;
        index += dollarTag.length;
        state = 'normal';
      } else {
        result += character;
        index += 1;
      }
      continue;
    }

    if (character === '-' && next === '-') {
      result += '  ';
      index += 2;
      state = 'line-comment';
      continue;
    }
    if (character === '/' && next === '*') {
      result += '  ';
      index += 2;
      state = 'block-comment';
      continue;
    }
    if (character === "'") {
      result += character;
      index += 1;
      state = 'single-quote';
      continue;
    }
    if (character === '"') {
      result += character;
      index += 1;
      state = 'double-quote';
      continue;
    }
    if (character === '$') {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        result += tag;
        index += tag.length;
        dollarTag = tag;
        state = 'dollar-quote';
        continue;
      }
    }
    result += character;
    index += 1;
  }
  return result;
}

function has(sql, expression) {
  return expression.test(sql);
}

function functionBody(sql, name) {
  const expression = new RegExp(
    `CREATE\\s+FUNCTION\\s+public\\.${escapeRegExp(name)}\\s*\\([^)]*\\)[\\s\\S]*?AS\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;`,
    'i',
  );
  return sql.match(expression)?.[1] ?? '';
}

function addFailure(failures, condition, message) {
  if (!condition) failures.push(message);
}

function signaturePattern(signature) {
  if (!signature) return '\\(\\s*\\)';
  return `\\(\\s*${signature.split(', ').map((part) => escapeRegExp(part)).join('\\s*,\\s*')}\\s*\\)`;
}

function validateMigration(migration, failures) {
  const sql = stripSqlComments(migration);
  const trimmed = sql.trim();
  addFailure(failures, /^BEGIN;\s/i.test(trimmed), 'migration must start with BEGIN;');
  addFailure(failures, /COMMIT;\s*$/i.test(trimmed), 'migration must end with COMMIT;');
  addFailure(failures, !/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(sql), 'migration must not use CREATE TABLE IF NOT EXISTS');
  addFailure(failures, !/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i.test(sql), 'migration must not use IF NOT EXISTS for indexes');
  addFailure(failures, has(sql, /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgcrypto/i), 'pgcrypto must provide UUID generation');
  addFailure(failures, has(sql, /DEFAULT\s+gen_random_uuid\(\)/i), 'v2 tables must use pgcrypto UUID defaults');
  addFailure(failures, !/REFERENCES\s+public\.users\b/i.test(sql), 'v2 foreign keys must not target legacy public.users');
  addFailure(failures, !/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.users\b/i.test(sql), 'migration must not alter or drop legacy public.users');
  addFailure(failures, !/\bRENAME\s+(?:TABLE|TO)\b[^;]*\busers\b/i.test(sql), 'migration must not rename legacy users');
  addFailure(failures, !/REVOKE\s+ALL\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public/i.test(sql), 'migration must not revoke privileges from all public tables');

  for (const table of REQUIRED_TABLES) {
    const escaped = escapeRegExp(table);
    addFailure(failures, has(sql, new RegExp(`CREATE\\s+TABLE\\s+public\\.${escaped}\\s*\\(`, 'i')), `missing additive table: ${table}`);
    addFailure(failures, has(sql, new RegExp(`ALTER\\s+TABLE\\s+public\\.${escaped}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i')), `RLS is not enabled for ${table}`);
  }

  for (const table of UPDATED_AT_TABLES) {
    addFailure(failures, has(sql, new RegExp(`CREATE\\s+TRIGGER\\s+${escapeRegExp(table)}_set_updated_at\\s+BEFORE\\s+UPDATE\\s+ON\\s+public\\.${escapeRegExp(table)}\\b`, 'i')), `updated_at trigger is missing for ${table}`);
  }
  addFailure(failures, has(sql, /CREATE\s+UNIQUE\s+INDEX\s+app_users_username_lower_key\s+ON\s+public\.app_users\s*\(\s*lower\s*\(\s*username\s*\)\s*\)/i), 'username must be unique after case normalization');
  addFailure(failures, has(sql, /CREATE\s+INDEX\s+works_public_directory_idx\s+ON\s+public\.works\s*\(\s*status\s*,\s*published_at\s+DESC\s*\)/i), 'published work directory index is missing');
  addFailure(failures, has(sql, /CREATE\s+INDEX\s+comments_work_list_idx\s+ON\s+public\.comments\s*\(\s*work_id\s*,\s*status\s*,\s*created_at\s+DESC\s*\)/i), 'comment list index is missing');
  addFailure(failures, has(sql, /CREATE\s+INDEX\s+submissions_queue_idx\s+ON\s+public\.submissions\s*\(\s*status\s*,\s*created_at\s*\)/i), 'submission queue index is missing');
  addFailure(failures, has(sql, /CREATE\s+INDEX\s+snapshot_jobs_queue_idx\s+ON\s+public\.snapshot_jobs\s*\(\s*status\s*,\s*created_at\s*\)/i), 'snapshot queue index is missing');
  addFailure(failures, has(sql, /(?:UNIQUE|PRIMARY\s+KEY)\s*\(\s*user_id\s*,\s*work_id\s*\)/i), 'interaction and progress uniqueness is missing');
  addFailure(failures, has(sql, /token_hash\s+text\s+NOT\s+NULL/i), 'session token hashes are required');
  addFailure(failures, has(sql, /code_hash\s+text\s+NOT\s+NULL/i), 'recovery-code hashes are required');
  addFailure(failures, has(sql, /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+NOTHING/i), 'like/favorite upsert must be idempotent');
  addFailure(failures, has(sql, /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+UPDATE/i), 'reading-progress upsert must be idempotent');
  addFailure(failures, has(sql, /SET\s+used_at\s*=\s*clock_timestamp\(\)/i), 'ticket and recovery-code consumption must mark a used timestamp');

  const appUsers = sql.match(/CREATE\s+TABLE\s+public\.app_users\s*\(([\s\S]*?)\);/i)?.[1] ?? '';
  addFailure(failures, has(appUsers, /username\s*=\s*btrim\s*\(\s*username\s*\)/i), 'username must reject surrounding whitespace');
  addFailure(failures, has(appUsers, /username\s*~\s*'\^\[A-Za-z0-9_\]\{3,32\}\$'/i), 'username must enforce the documented ASCII identifier regex');

  const challenge = functionBody(sql, 'answer_registration_challenge');
  addFailure(failures, Boolean(challenge), 'missing atomic challenge answer function');
  addFailure(failures, has(challenge, /SELECT\s+\*\s+INTO\s+v_challenge[\s\S]*?FROM\s+public\.registration_challenges[\s\S]*?status\s*=\s*'pending'[\s\S]*?expires_at\s*>\s*clock_timestamp\(\)[\s\S]*?FOR\s+UPDATE/i), 'challenge answer must lock one pending, unexpired challenge row');
  addFailure(failures, has(challenge, /v_challenge\.attempt_count\s*>=\s*v_challenge\.max_attempts/i), 'challenge answer must enforce the attempt limit under the row lock');
  addFailure(failures, has(challenge, /INSERT\s+INTO\s+public\.registration_attempts/i), 'challenge answer must record the attempt atomically');
  addFailure(failures, has(challenge, /UPDATE\s+public\.registration_challenges[\s\S]*?status\s*=\s*'passed'/i), 'challenge answer must mark a passing challenge');
  addFailure(failures, has(challenge, /INSERT\s+INTO\s+public\.registration_tickets/i), 'challenge answer must issue a ticket in the same function');

  const ticketConsumer = functionBody(sql, 'consume_registration_ticket');
  addFailure(failures, has(ticketConsumer, /UPDATE\s+public\.registration_tickets[\s\S]*?SET\s+used_at\s*=\s*clock_timestamp\(\)[\s\S]*?used_at\s+IS\s+NULL[\s\S]*?RETURNING/i), 'ticket consumer must atomically claim an unused ticket');
  addFailure(failures, has(ticketConsumer, /INSERT\s+INTO\s+public\.app_users[\s\S]*?INSERT\s+INTO\s+public\.user_sessions/i), 'ticket consumer must create user and session in one routine');

  const comments = functionBody(sql, 'backend_v2_enforce_comment_reply_depth');
  addFailure(failures, has(comments, /FOR\s+KEY\s+SHARE/i), 'comment parent must be locked while validating a reply');
  addFailure(failures, has(comments, /v_parent_work_id\s*<>\s*NEW\.work_id/i), 'comment replies must stay on the same work');
  addFailure(failures, has(comments, /v_parent_parent_id\s+IS\s+NOT\s+NULL/i), 'comment replies must be one level deep');

  const submissionAssets = sql.match(/CREATE\s+TABLE\s+public\.submission_assets\s*\(([\s\S]*?)\);/i)?.[1] ?? '';
  addFailure(failures, has(submissionAssets, /UNIQUE\s*\(\s*upload_file_id\s*\)/i), 'each upload file must bind to at most one submission');

  for (const [name, signature] of Object.entries(REQUIRED_FUNCTIONS)) {
    const escaped = escapeRegExp(name);
    addFailure(failures, has(sql, new RegExp(`CREATE\\s+FUNCTION\\s+public\\.${escaped}\\s*\\(`, 'i')), `missing SQL routine: ${name}`);
    const revokeExpression = new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${escaped}${signaturePattern(signature)}\\s+FROM\\s+PUBLIC\\s*;`, 'i');
    addFailure(failures, has(sql, revokeExpression), `PUBLIC execute privilege must be revoked for ${name}`);
  }
  addFailure(failures, /REVOKE\s+ALL\s+ON\s+TABLE\s+[^;]*\s+FROM\s+PUBLIC\s*;/i.test(sql), 'PUBLIC table permissions must be revoked');
}

function validateRuntimeAccess(runtimeAccess, failures) {
  const sql = stripSqlComments(runtimeAccess);
  const trimmed = sql.trim();
  addFailure(failures, /BEGIN;\s/i.test(trimmed), 'runtime access script must start a transaction');
  addFailure(failures, /COMMIT;\s*$/i.test(trimmed), 'runtime access script must commit its transaction');
  addFailure(failures, has(sql, /GRANT\s+USAGE\s+ON\s+SCHEMA\s+public\s+TO\s+:"backend_role"/i), 'runtime role must receive schema USAGE');
  addFailure(failures, !/\bpublic\.users\b/i.test(sql), 'runtime access must not grant access to legacy public.users');
  const tableGrant = sql.match(/GRANT\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+TABLE\s+([\s\S]*?)\s+TO\s+:"backend_role"\s*;/i)?.[1] ?? '';
  addFailure(failures, Boolean(tableGrant), 'runtime role table grant is missing');
  for (const table of REQUIRED_TABLES) {
    addFailure(failures, has(tableGrant, new RegExp(`\\bpublic\\.${escapeRegExp(table)}\\b`, 'i')), `runtime role table grant is missing for ${table}`);
    addFailure(failures, has(sql, new RegExp(`CREATE\\s+POLICY\\s+backend_v2_runtime_all\\s+ON\\s+public\\.${escapeRegExp(table)}\\s+FOR\\s+ALL\\s+TO\\s+:"backend_role"\\s+USING\\s*\\(\\s*true\\s*\\)\\s+WITH\\s+CHECK\\s*\\(\\s*true\\s*\\)`, 'i')), `runtime RLS policy is missing for ${table}`);
  }
  const functionGrant = sql.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\s\S]*?)\s+TO\s+:"backend_role"\s*;/i)?.[1] ?? '';
  for (const [name, signature] of Object.entries(REQUIRED_FUNCTIONS)) {
    if (name.startsWith('backend_v2_')) continue;
    addFailure(failures, has(functionGrant, new RegExp(`public\\.${escapeRegExp(name)}${signaturePattern(signature)}`, 'i')), `runtime role function grant is missing for ${name}`);
  }
}

function validateRollback(rollback, failures) {
  const sql = stripSqlComments(rollback);
  const trimmed = sql.trim();
  addFailure(failures, /^BEGIN;\s/i.test(trimmed), 'rollback must start with BEGIN;');
  addFailure(failures, /COMMIT;\s*$/i.test(trimmed), 'rollback must end with COMMIT;');
  addFailure(failures, !/DROP\s+EXTENSION\s+(?:IF\s+EXISTS\s+)?pgcrypto/i.test(sql), 'rollback must not remove a possibly pre-existing pgcrypto extension');
  addFailure(failures, !/\bDROP\s+TABLE\b[^;]*\bpublic\.users\b/i.test(sql), 'rollback must not drop legacy public.users');

  const triggerDrops = [...sql.matchAll(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+[^;]+;/gi)].map((match) => match.index ?? 0);
  const functionDrops = [...sql.matchAll(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.[^;]+;/gi)].map((match) => match.index ?? 0);
  const tableDrops = [...sql.matchAll(/DROP\s+TABLE\s+IF\s+EXISTS\s+public\.[^;]+;/gi)].map((match) => match.index ?? 0);
  addFailure(failures, triggerDrops.length > 0 && functionDrops.length > 0 && Math.max(...triggerDrops) < Math.min(...functionDrops), 'rollback must drop triggers before functions');
  addFailure(failures, functionDrops.length > 0 && tableDrops.length > 0 && Math.max(...functionDrops) < Math.min(...tableDrops), 'rollback must drop functions before tables');
  for (const table of UPDATED_AT_TABLES) {
    addFailure(failures, has(sql, new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${escapeRegExp(table)}_set_updated_at\\s+ON\\s+public\\.${escapeRegExp(table)}`, 'i')), `rollback must remove ${table} updated_at trigger`);
  }
  addFailure(failures, has(sql, /DROP\s+TRIGGER\s+IF\s+EXISTS\s+comments_enforce_reply_depth\s+ON\s+public\.comments/i), 'rollback must remove comment depth trigger');
  addFailure(failures, has(sql, /DROP\s+TRIGGER\s+IF\s+EXISTS\s+submission_assets_validate\s+ON\s+public\.submission_assets/i), 'rollback must remove submission asset trigger');
  for (const [name, signature] of Object.entries(REQUIRED_FUNCTIONS)) {
    addFailure(failures, has(sql, new RegExp(`DROP\\s+FUNCTION\\s+IF\\s+EXISTS\\s+public\\.${escapeRegExp(name)}${signaturePattern(signature)}\\s*;`, 'i')), `rollback must remove ${name}`);
  }
  for (const table of REQUIRED_TABLES) {
    addFailure(failures, has(sql, new RegExp(`DROP\\s+TABLE\\s+IF\\s+EXISTS\\s+public\\.${escapeRegExp(table)}\\s*;`, 'i')), `rollback must drop v2 table ${table}`);
  }
}

export function validateBackendSchema({ migration, rollback, runtimeAccess }) {
  const failures = [];
  validateMigration(migration, failures);
  validateRuntimeAccess(runtimeAccess, failures);
  validateRollback(rollback, failures);
  return failures;
}

// Alias kept intentionally small so callers can use the verifier as a pure
// string validator in mutation tests without invoking the CLI.
export const verifyBackendSchema = validateBackendSchema;

export function verifyBackendSchemaFromFiles({ migrationPath, rollbackPath, runtimeAccessPath } = {}) {
  const files = {
    migrationPath: migrationPath ?? process.env.BACKEND_V2_MIGRATION_PATH ?? resolve(root, 'cloudbase/migrations/20260918_backend_v2.sql'),
    rollbackPath: rollbackPath ?? process.env.BACKEND_V2_ROLLBACK_PATH ?? resolve(root, 'cloudbase/migrations/20260918_backend_v2_rollback.sql'),
    runtimeAccessPath: runtimeAccessPath ?? process.env.BACKEND_V2_RUNTIME_ACCESS_PATH ?? resolve(root, 'cloudbase/migrations/20260918_backend_v2_runtime_access.sql'),
  };
  return validateBackendSchema({
    migration: readFileSync(files.migrationPath, 'utf8'),
    rollback: readFileSync(files.rollbackPath, 'utf8'),
    runtimeAccess: readFileSync(files.runtimeAccessPath, 'utf8'),
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const failures = verifyBackendSchemaFromFiles();
  if (failures.length > 0) {
    console.error(`backend v2 schema static verification failed:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('backend v2 schema static verification passed');
  }
}
