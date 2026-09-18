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

const RUNTIME_TABLE_GRANTS = {
  app_users: ['SELECT', 'UPDATE_COLUMNS'],
  user_sessions: ['SELECT'],
  question_bank: ['SELECT'],
  registration_challenges: ['SELECT', 'INSERT'],
  registration_attempts: ['SELECT'],
  registration_tickets: ['SELECT'],
  recovery_codes: ['SELECT'],
  age_consents: ['SELECT', 'INSERT', 'UPDATE'],
  works: ['SELECT', 'INSERT', 'UPDATE'],
  work_assets: ['SELECT', 'INSERT', 'UPDATE'],
  tags: ['SELECT', 'INSERT', 'UPDATE'],
  work_tags: ['SELECT', 'INSERT', 'DELETE'],
  work_versions: ['SELECT', 'INSERT'],
  work_likes: ['SELECT'],
  favorites: ['SELECT'],
  comments: ['SELECT', 'INSERT', 'UPDATE'],
  reading_progress: ['SELECT'],
  reports: ['SELECT', 'INSERT', 'UPDATE'],
  upload_sessions: ['SELECT', 'INSERT', 'UPDATE'],
  upload_files: ['SELECT', 'INSERT', 'UPDATE'],
  submissions: ['SELECT', 'INSERT', 'UPDATE'],
  submission_assets: ['SELECT', 'INSERT'],
  snapshot_jobs: ['SELECT', 'INSERT', 'UPDATE'],
  snapshot_versions: ['SELECT', 'INSERT'],
  moderation_actions: ['SELECT', 'INSERT'],
  audit_logs: ['SELECT', 'INSERT'],
  site_settings: ['SELECT', 'INSERT', 'UPDATE'],
  blocked_subjects: ['SELECT', 'INSERT', 'UPDATE'],
  rate_limit_buckets: ['SELECT', 'INSERT', 'UPDATE'],
};

const RUNTIME_FUNCTIONS = Object.fromEntries(
  Object.entries(REQUIRED_FUNCTIONS).filter(([name]) => !name.startsWith('backend_v2_')),
);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remove SQL comments without changing quoted strings or dollar-quoted bodies. */
export function stripSqlComments(source) {
  let result = '';
  let state = 'normal';
  let dollarTag = '';

  for (let index = 0; index < source.length;) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'line-comment' || state === 'dollar-line-comment') {
      if (character === '\n') {
        result += '\n';
        state = state === 'dollar-line-comment' ? 'dollar-quote' : 'normal';
      }
      index += 1;
      continue;
    }
    if (state === 'block-comment' || state === 'dollar-block-comment') {
      if (character === '*' && next === '/') {
        result += '  ';
        index += 2;
        state = state === 'dollar-block-comment' ? 'dollar-quote' : 'normal';
      } else {
        result += character === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote' || state === 'dollar-single-quote') {
      result += character;
      if (character === "'" && next === "'") {
        result += next;
        index += 2;
      } else {
        if (character === "'") state = state === 'dollar-single-quote' ? 'dollar-quote' : 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'double-quote' || state === 'dollar-double-quote') {
      result += character;
      if (character === '"' && next === '"') {
        result += next;
        index += 2;
      } else {
        if (character === '"') state = state === 'dollar-double-quote' ? 'dollar-quote' : 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'dollar-quote') {
      if (source.startsWith(dollarTag, index)) {
        result += dollarTag;
        index += dollarTag.length;
        state = 'normal';
      } else if (character === '-' && next === '-') {
        result += '  ';
        index += 2;
        state = 'dollar-line-comment';
      } else if (character === '/' && next === '*') {
        result += '  ';
        index += 2;
        state = 'dollar-block-comment';
      } else if (character === "'") {
        result += character;
        index += 1;
        state = 'dollar-single-quote';
      } else if (character === '"') {
        result += character;
        index += 1;
        state = 'dollar-double-quote';
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

function functionDefinition(sql, name) {
  const expression = new RegExp(
    `CREATE\\s+FUNCTION\\s+public\\.${escapeRegExp(name)}\\s*\\([^)]*\\)[\\s\\S]*?AS\\s+\\$\\$`,
    'i',
  );
  return sql.match(expression)?.[0] ?? '';
}

function tableBody(sql, name) {
  const expression = new RegExp(
    `CREATE\\s+TABLE\\s+public\\.${escapeRegExp(name)}\\s*\\(([\\s\\S]*?)\\);`,
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
  addFailure(failures, has(sql, /token_hash\s+text\s+NOT\s+NULL/i), 'session token hashes are required');
  addFailure(failures, has(sql, /code_hash\s+text\s+NOT\s+NULL/i), 'recovery-code hashes are required');
  addFailure(failures, has(sql, /SET\s+used_at\s*=\s*clock_timestamp\(\)/i), 'ticket and recovery-code consumption must mark a used timestamp');

  for (const table of ['work_likes', 'favorites', 'reading_progress']) {
    addFailure(failures, has(tableBody(sql, table), /(?:UNIQUE|PRIMARY\s+KEY)\s*\(\s*user_id\s*,\s*work_id\s*\)/i), `${table} must have user/work uniqueness`);
  }

  const appUsers = sql.match(/CREATE\s+TABLE\s+public\.app_users\s*\(([\s\S]*?)\);/i)?.[1] ?? '';
  addFailure(failures, has(appUsers, /username\s*=\s*btrim\s*\(\s*username\s*\)/i), 'username must reject surrounding whitespace');
  addFailure(failures, has(appUsers, /username\s*~\s*'\^\[A-Za-z0-9_\]\{3,32\}\$'/i), 'username must enforce the documented ASCII identifier regex');

  const challenge = functionBody(sql, 'answer_registration_challenge');
  addFailure(failures, Boolean(challenge), 'missing atomic challenge answer function');
  for (const name of Object.keys(REQUIRED_FUNCTIONS)) {
    const definition = functionDefinition(sql, name);
    addFailure(failures, has(definition, /SECURITY\s+DEFINER/i), `${name} must be SECURITY DEFINER`);
    addFailure(failures, has(definition, /SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i), `${name} must pin search_path`);
  }
  addFailure(failures, has(challenge, /SELECT\s+\*\s+INTO\s+v_challenge[\s\S]*?FROM\s+public\.registration_challenges[\s\S]*?status\s*=\s*'pending'[\s\S]*?expires_at\s*>\s*clock_timestamp\(\)[\s\S]*?FOR\s+UPDATE/i), 'challenge answer must lock one pending, unexpired challenge row');
  addFailure(failures, has(challenge, /v_challenge\.attempt_count\s*>=\s*v_challenge\.max_attempts/i), 'challenge answer must enforce the attempt limit under the row lock');
  addFailure(failures, has(challenge, /INSERT\s+INTO\s+public\.registration_attempts/i), 'challenge answer must record the attempt atomically');
  addFailure(failures, has(challenge, /UPDATE\s+public\.registration_challenges[\s\S]*?status\s*=\s*'passed'/i), 'challenge answer must mark a passing challenge');
  addFailure(failures, has(challenge, /INSERT\s+INTO\s+public\.registration_tickets/i), 'challenge answer must issue a ticket in the same function');

  const ticketConsumer = functionBody(sql, 'consume_registration_ticket');
  addFailure(failures, has(ticketConsumer, /UPDATE\s+public\.registration_tickets[\s\S]*?SET\s+used_at\s*=\s*clock_timestamp\(\)[\s\S]*?used_at\s+IS\s+NULL[\s\S]*?RETURNING/i), 'ticket consumer must atomically claim an unused ticket');
  addFailure(failures, has(ticketConsumer, /INSERT\s+INTO\s+public\.app_users[\s\S]*?INSERT\s+INTO\s+public\.user_sessions/i), 'ticket consumer must create user and session in one routine');

  addFailure(failures, has(functionBody(sql, 'set_work_like'), /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+NOTHING/i), 'like upsert must be idempotent');
  addFailure(failures, has(functionBody(sql, 'set_favorite'), /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+NOTHING/i), 'favorite upsert must be idempotent');
  addFailure(failures, has(functionBody(sql, 'sync_reading_progress'), /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+UPDATE/i), 'reading-progress upsert must be idempotent');

  const comments = functionBody(sql, 'backend_v2_enforce_comment_reply_depth');
  addFailure(failures, has(comments, /FOR\s+KEY\s+SHARE/i), 'comment parent must be locked while validating a reply');
  addFailure(failures, has(comments, /v_parent_work_id\s*<>\s*NEW\.work_id/i), 'comment replies must stay on the same work');
  addFailure(failures, has(comments, /v_parent_parent_id\s+IS\s+NOT\s+NULL/i), 'comment replies must be one level deep');
  addFailure(failures, has(comments, /IF\s+TG_OP\s*=\s*'UPDATE'[\s\S]*?NEW\.parent_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.parent_id[\s\S]*?OR\s+NEW\.work_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.work_id[\s\S]*?THEN\s+RAISE\s+EXCEPTION/i), 'comment parent/work links must be immutable after insert');

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
  addFailure(failures, !/GRANT\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+TABLE/i.test(sql), 'runtime role grants must be least privilege');
  addFailure(failures, !/\bFOR\s+ALL\b/i.test(sql), 'runtime RLS policies must not use FOR ALL');

  const tableGrants = new Map(REQUIRED_TABLES.map((table) => [table, new Set()]));
  const tableGrantExpression = /GRANT\s+((?:SELECT|INSERT|UPDATE|DELETE)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE))*)\s+ON\s+TABLE\s+([\s\S]*?)\s+TO\s+:"backend_role"\s*;/gi;
  for (const match of sql.matchAll(tableGrantExpression)) {
    const operations = match[1].toUpperCase().split(/\s*,\s*/);
    for (const tableReference of match[2].split(',')) {
      const table = tableReference.trim().match(/^public\.([a-z_][a-z0-9_]*)$/i)?.[1];
      if (tableGrants.has(table)) {
        for (const operation of operations) tableGrants.get(table).add(operation);
      }
    }
  }
  addFailure(failures, has(sql, /GRANT\s+UPDATE\s*\(\s*username\s*,\s*status\s*,\s*last_login_at\s*\)\s+ON\s+TABLE\s+public\.app_users\s+TO\s+:"backend_role"/i), 'app_users update must be limited to profile/status/last-login columns');
  if (has(sql, /GRANT\s+UPDATE\s*\(\s*username\s*,\s*status\s*,\s*last_login_at\s*\)\s+ON\s+TABLE\s+public\.app_users\s+TO\s+:"backend_role"/i)) {
    tableGrants.get('app_users').add('UPDATE');
  }

  const policyMap = new Map(REQUIRED_TABLES.map((table) => [table, new Set()]));
  const policyExpression = /CREATE\s+POLICY\s+\S+\s+ON\s+public\.([a-z_][a-z0-9_]*)\s+FOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\s+TO\s+:"backend_role"[\s\S]*?;/gi;
  for (const match of sql.matchAll(policyExpression)) {
    const table = match[1];
    const operation = match[2].toUpperCase();
    if (policyMap.has(table)) policyMap.get(table).add(operation);
  }
  for (const [table, expectedDefinition] of Object.entries(RUNTIME_TABLE_GRANTS)) {
    const expectedGrants = new Set(expectedDefinition.filter((operation) => operation !== 'UPDATE_COLUMNS'));
    if (expectedDefinition.includes('UPDATE_COLUMNS')) expectedGrants.add('UPDATE');
    const actualGrants = tableGrants.get(table);
    addFailure(failures, actualGrants.size === expectedGrants.size && [...expectedGrants].every((operation) => actualGrants.has(operation)), `runtime role table grant is not least privilege for ${table}`);
    const actualPolicies = policyMap.get(table);
    addFailure(failures, actualPolicies.size === expectedGrants.size && [...expectedGrants].every((operation) => actualPolicies.has(operation)), `runtime RLS policies do not mirror grants for ${table}`);
  }
  for (const [table, actualPolicies] of policyMap) {
    for (const operation of actualPolicies) {
      const expectedDefinition = RUNTIME_TABLE_GRANTS[table] ?? [];
      const expected = new Set(expectedDefinition.filter((item) => item !== 'UPDATE_COLUMNS'));
      if (expectedDefinition.includes('UPDATE_COLUMNS')) expected.add('UPDATE');
      addFailure(failures, expected.has(operation), `runtime policy grants an undeclared ${operation} operation on ${table}`);
    }
  }

  const functionGrant = sql.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\s\S]*?)\s+TO\s+:"backend_role"\s*;/i)?.[1] ?? '';
  for (const [name, signature] of Object.entries(RUNTIME_FUNCTIONS)) {
    addFailure(failures, has(functionGrant, new RegExp(`public\\.${escapeRegExp(name)}${signaturePattern(signature)}`, 'i')), `runtime role function grant is missing for ${name}`);
  }
  const grantedFunctionNames = [...functionGrant.matchAll(/public\.([a-z_][a-z0-9_]*)\s*\(/gi)].map((match) => match[1]);
  addFailure(failures, grantedFunctionNames.length === Object.keys(RUNTIME_FUNCTIONS).length && grantedFunctionNames.every((name) => Object.hasOwn(RUNTIME_FUNCTIONS, name)), 'runtime role must receive only explicit business function grants');
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
