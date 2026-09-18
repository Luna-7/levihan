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
  'blocked_subjects', 'rate_limit_buckets', 'idempotency_records',
];

export const REQUIRED_FUNCTIONS = {
  backend_v2_set_updated_at: '',
  backend_v2_enforce_comment_reply_depth: '',
  backend_v2_validate_submission_asset: '',
  answer_registration_challenge: 'uuid, boolean, integer, integer, text, timestamptz',
  validate_registration_ticket: 'text',
  consume_registration_ticket: 'text, text, text, text, timestamptz, text, text',
  create_login_session: 'uuid, text, timestamptz, text, text',
  rotate_user_session: 'text, text, timestamptz, text',
  consume_recovery_code: 'text, text, text, text, timestamptz, text',
  confirm_recovery_session: 'text, text',
  promote_app_user: 'uuid, uuid, boolean, text',
  set_work_like: 'uuid, uuid, boolean',
  set_favorite: 'uuid, uuid, boolean',
  sync_reading_progress: 'uuid, uuid, bigint, numeric, bigint, timestamptz',
  consume_rate_limit_bucket: 'text, text, integer, integer, timestamptz',
  resolve_user_session: 'text',
  revoke_user_session: 'text',
  begin_idempotent_request: 'text, text, text, text',
  complete_idempotent_request: 'text, text, text, text, jsonb',
  fail_idempotent_request: 'text, text, text, text',
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
  question_bank: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
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

const SQL_IDENTIFIER = '(?:"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_$]*)';
const qualifiedTableReferenceExpression = new RegExp(`^\\s*(${SQL_IDENTIFIER})\\s*\\.\\s*(${SQL_IDENTIFIER})\\s*$`);

function normalizeIdentifier(identifier) {
  const trimmed = identifier.trim();
  return trimmed.startsWith('"')
    ? trimmed.slice(1, -1).replaceAll('""', '"')
    : trimmed.toLowerCase();
}

function publicTableName(tableReference) {
  const match = tableReference.match(qualifiedTableReferenceExpression);
  if (!match || normalizeIdentifier(match[1]) !== 'public') return null;
  return normalizeIdentifier(match[2]);
}

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
  addFailure(failures, has(appUsers, /username\s*=\s*lower\s*\(\s*username\s*\)/i), 'username must be stored in canonical lowercase form');
  addFailure(failures, has(appUsers, /username\s*~\s*'\^\[a-z0-9_\]\{3,32\}\$'/i), 'username must enforce the documented ASCII identifier regex');
  addFailure(failures, has(appUsers, /recovery_confirmed_at\s+timestamptz(?:\s+DEFAULT\s+NULL)?/i), 'app users must track account-level recovery confirmation');

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
  addFailure(failures, has(challenge, /unnest\s*\(\s*v_challenge\.question_ids\s*,\s*v_challenge\.question_versions\s*\)[\s\S]*?JOIN\s+public\.question_bank\s+AS\s+question[\s\S]*?question\.version\s*<>\s*selected\.question_version/i), 'challenge answer must reject changed question versions');

  const ticketConsumer = functionBody(sql, 'consume_registration_ticket');
  addFailure(failures, has(ticketConsumer, /UPDATE\s+public\.registration_tickets[\s\S]*?SET\s+used_at\s*=\s*clock_timestamp\(\)[\s\S]*?used_at\s+IS\s+NULL[\s\S]*?RETURNING/i), 'ticket consumer must atomically claim an unused ticket');
  addFailure(failures, has(ticketConsumer, /INSERT\s+INTO\s+public\.app_users[\s\S]*?INSERT\s+INTO\s+public\.user_sessions/i), 'ticket consumer must create user and session in one routine');
  addFailure(failures, has(ticketConsumer, /INSERT\s+INTO\s+public\.recovery_codes/i), 'registration ticket must insert an initial recovery code');
  addFailure(failures, !/challenge\.expires_at\s*>\s*clock_timestamp\(\)/i.test(ticketConsumer), 'ticket expiry, not challenge expiry, must control registration consumption');
  addFailure(failures, has(ticketConsumer, /INSERT\s+INTO\s+public\.rate_limit_buckets\s+AS\s+current_bucket[\s\S]*?'registration-success'[\s\S]*?ON\s+CONFLICT\s*\(\s*subject_hash\s*,\s*bucket\s*,\s*window_started_at\s*\)\s+DO\s+UPDATE[\s\S]*?hit_count\s*=\s*current_bucket\.hit_count\s*\+\s*1/i), 'registration must count successful creations atomically');
  addFailure(failures, has(ticketConsumer, /v_registration_count\s*>\s*3[\s\S]*?registration_success_rate_limited/i), 'registration success quota must reject the fourth hourly creation');
  addFailure(failures, has(ticketConsumer, /INSERT\s+INTO\s+public\.user_sessions\s*\([^)]*recovery_confirmed_at[^)]*\)[\s\S]*?VALUES\s*\([^)]*NULL\s*\)/i), 'registration session must start recovery-unconfirmed');

  const ticketValidator = functionBody(sql, 'validate_registration_ticket');
  addFailure(failures, Boolean(ticketValidator), 'missing registration-ticket preflight routine');
  addFailure(failures, has(ticketValidator, /FROM\s+public\.registration_tickets\s+AS\s+ticket[\s\S]*?JOIN\s+public\.registration_challenges\s+AS\s+challenge/i), 'ticket preflight must bind the ticket to its challenge');
  addFailure(failures, has(ticketValidator, /p_ticket_token_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'[\s\S]*?ticket\.token_hash\s*=\s*p_ticket_token_hash/i), 'ticket preflight must validate and match only the hashed token');
  addFailure(failures, has(ticketValidator, /ticket\.used_at\s+IS\s+NULL/i), 'ticket preflight must reject used tickets');
  addFailure(failures, has(ticketValidator, /ticket\.expires_at\s*>\s*clock_timestamp\(\)/i), 'ticket preflight must reject expired tickets');
  addFailure(failures, has(ticketValidator, /challenge\.status\s*=\s*'passed'/i), 'ticket preflight must require a passed challenge');
  addFailure(failures, !/(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\./i.test(ticketValidator), 'ticket preflight must remain read-only');

  const loginSession = functionBody(sql, 'create_login_session');
  addFailure(failures, Boolean(loginSession), 'missing controlled routine: create_login_session');
  addFailure(failures, has(loginSession, /p_expires_at\s+<=\s+clock_timestamp\(\)/i), 'login session must reject expired sessions');
  addFailure(failures, has(loginSession, /public\.app_users[\s\S]*?status\s*=\s*'active'[\s\S]*?FOR\s+NO\s+KEY\s+UPDATE/i), 'login session must lock the active app user against concurrent recovery');
  addFailure(failures, has(loginSession, /login_user\.recovery_confirmed_at\s+IS\s+NOT\s+NULL/i), 'login session must reject recovery-unconfirmed accounts');
  addFailure(failures, has(loginSession, /INSERT\s+INTO\s+public\.user_sessions/i), 'login session must insert a session');
  addFailure(failures, has(loginSession, /p_current_token_hash[\s\S]*?UPDATE\s+public\.user_sessions[\s\S]*?token_hash\s*=\s*p_current_token_hash[\s\S]*?revoked_at\s+IS\s+NULL/i), 'login session must revoke the optional current browser session');
  addFailure(failures, has(loginSession, /INSERT\s+INTO\s+public\.user_sessions\s*\([^)]*recovery_confirmed_at[^)]*\)[\s\S]*?clock_timestamp\(\)/i), 'ordinary login sessions must be recovery-confirmed');

  const recoveryConsumer = functionBody(sql, 'consume_recovery_code');
  addFailure(failures, has(recoveryConsumer, /UPDATE\s+public\.recovery_codes[\s\S]*?SET\s+used_at\s*=\s*clock_timestamp\(\)[\s\S]*?used_at\s+IS\s+NULL[\s\S]*?RETURNING/i), 'recovery code must atomically mark used_at');
  addFailure(failures, has(recoveryConsumer, /UPDATE\s+public\.app_users[\s\S]*?password_hash/i), 'recovery code must update the password');
  addFailure(failures, has(recoveryConsumer, /UPDATE\s+public\.app_users[\s\S]*?recovery_confirmed_at\s*=\s*NULL/i), 'recovery must reset account-level confirmation');
  addFailure(failures, has(recoveryConsumer, /UPDATE\s+public\.user_sessions[\s\S]*?revoked_at\s*=\s*clock_timestamp/i), 'recovery code must revoke existing sessions');
  addFailure(failures, has(recoveryConsumer, /INSERT\s+INTO\s+public\.recovery_codes/i), 'recovery code must insert a replacement recovery code');
  addFailure(failures, has(recoveryConsumer, /INSERT\s+INTO\s+public\.user_sessions/i), 'recovery code must create a replacement session');
  addFailure(failures, has(recoveryConsumer, /INSERT\s+INTO\s+public\.user_sessions\s*\([^)]*recovery_confirmed_at[^)]*\)[\s\S]*?VALUES\s*\([^)]*NULL\s*\)/i), 'recovery session must start recovery-unconfirmed');

  const recoveryConfirmation = functionBody(sql, 'confirm_recovery_session');
  addFailure(failures, has(recoveryConfirmation, /UPDATE\s+public\.user_sessions\s+AS\s+session[\s\S]*?SET\s+recovery_confirmed_at\s*=\s*v_now/i), 'recovery confirmation must mark its session confirmed');
  addFailure(failures, has(recoveryConfirmation, /session\.token_hash\s*=\s*p_session_token_hash[\s\S]*?session\.revoked_at\s+IS\s+NULL[\s\S]*?session\.expires_at\s*>\s*clock_timestamp\(\)[\s\S]*?session\.recovery_confirmed_at\s+IS\s+NULL/i), 'recovery confirmation must require an active unconfirmed session');
  addFailure(failures, has(recoveryConfirmation, /recovery\.user_id\s*=\s*session\.user_id[\s\S]*?recovery\.code_hash\s*=\s*p_recovery_code_hash[\s\S]*?recovery\.used_at\s+IS\s+NULL/i), 'recovery confirmation must match an unused code owned by the session user');
  addFailure(failures, has(recoveryConfirmation, /account\.id\s*=\s*session\.user_id[\s\S]*?account\.status\s*=\s*'active'[\s\S]*?account\.recovery_confirmed_at\s+IS\s+NULL/i), 'recovery confirmation must lock to the active unconfirmed owning account');
  addFailure(failures, has(recoveryConfirmation, /UPDATE\s+public\.app_users[\s\S]*?SET\s+recovery_confirmed_at\s*=\s*v_now[\s\S]*?WHERE\s+id\s*=\s*v_user_id[\s\S]*?recovery_confirmed_at\s+IS\s+NULL/i), 'recovery confirmation must confirm the owning account in the same routine');
  addFailure(failures, !/UPDATE\s+public\.recovery_codes[\s\S]*?used_at/i.test(recoveryConfirmation), 'recovery confirmation must not consume the recovery code');
  addFailure(failures, has(recoveryConfirmation, /RETURN\s+QUERY[\s\S]*?SELECT\s+app_user\.id\s*,\s*app_user\.username\s*,\s*app_user\.role\s*,\s*app_user\.status/i), 'recovery confirmation must return its safe user profile atomically');

  const promoter = functionBody(sql, 'promote_app_user');
  addFailure(failures, Boolean(promoter), 'missing controlled routine: promote_app_user');
  addFailure(failures, has(promoter, /NOT\s+p_reauthenticated/i), 'admin promotion must require reauthentication');
  addFailure(failures, has(promoter, /public\.app_users[\s\S]*?status\s*=\s*'active'[\s\S]*?role\s*=\s*'admin'[\s\S]*?FOR\s+KEY\s+SHARE/i), 'admin promotion must require an active admin actor');
  addFailure(failures, has(promoter, /p_target_id[\s\S]*?status\s*=\s*'active'[\s\S]*?FOR\s+UPDATE/i), 'admin promotion must require an active target');
  addFailure(failures, has(promoter, /UPDATE\s+public\.app_users\s+SET\s+role\s*=\s*'admin'/i), 'admin promotion must set the target role to admin');
  addFailure(failures, !/SET\s+role\s*=\s*'member'|DELETE\s+FROM\s+public\.app_users/i.test(promoter), 'admin promotion must not demote or delete users');
  addFailure(failures, has(promoter, /INSERT\s+INTO\s+public\.audit_logs[\s\S]*?p_actor_id[\s\S]*?p_request_id/i), 'admin promotion must write an audit log with request id');

  addFailure(failures, has(functionBody(sql, 'set_work_like'), /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+NOTHING/i), 'like upsert must be idempotent');
  addFailure(failures, has(functionBody(sql, 'set_favorite'), /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+NOTHING/i), 'favorite upsert must be idempotent');
  addFailure(failures, has(functionBody(sql, 'sync_reading_progress'), /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*work_id\s*\)\s+DO\s+UPDATE/i), 'reading-progress upsert must be idempotent');
  const rateLimit = functionBody(sql, 'consume_rate_limit_bucket');
  addFailure(failures, has(rateLimit, /INSERT\s+INTO\s+public\.rate_limit_buckets\s+AS\s+current_bucket[\s\S]*?ON\s+CONFLICT[\s\S]*?hit_count\s*=\s*current_bucket\.hit_count\s*\+\s*1/i), 'rate-limit consumer must increment through the current_bucket alias');
  addFailure(failures, has(rateLimit, /accepted[\s\S]*?retry_after_seconds/i), 'rate-limit consumer must return accepted and retry_after_seconds');

  const sessionResolver = functionBody(sql, 'resolve_user_session');
  addFailure(failures, has(sessionResolver, /JOIN\s+public\.app_users\s+AS\s+app_user\s+ON\s+app_user\.id\s*=\s*session\.user_id/i), 'session resolver must join the owning app user');
  addFailure(failures, has(sessionResolver, /session\.token_hash\s*=\s*p_token_hash/i), 'session resolver must match the token hash');
  addFailure(failures, has(sessionResolver, /session\.revoked_at\s+IS\s+NULL/i), 'session resolver must reject revoked sessions');
  addFailure(failures, has(sessionResolver, /session\.expires_at\s*>\s*clock_timestamp\(\)/i), 'session resolver must reject expired sessions');
  addFailure(failures, has(sessionResolver, /session\.recovery_confirmed_at\s+IS\s+NOT\s+NULL/i), 'session resolver must reject recovery-unconfirmed sessions');
  addFailure(failures, has(sessionResolver, /app_user\.recovery_confirmed_at\s+IS\s+NOT\s+NULL/i), 'session resolver must reject recovery-unconfirmed accounts');
  addFailure(failures, has(sessionResolver, /app_user\.status\s*=\s*'active'/i), 'session resolver must require an active user');
  addFailure(failures, has(sessionResolver, /SELECT\s+session\.user_id\s*,\s*app_user\.role/i), 'session resolver must return only user id and role');

  const questionBank = tableBody(sql, 'question_bank');
  addFailure(failures, has(questionBank, /options\s+jsonb\s+NOT\s+NULL/i), 'question bank must store JSON options');
  addFailure(failures, has(questionBank, /jsonb_array_length\s*\(\s*options\s*\)\s+BETWEEN\s+2\s+AND\s+8/i), 'question options must contain two to eight values');
  addFailure(failures, has(questionBank, /NOT\s+options\s+@\?/i), 'question options must reject non-string and blank values');

  const registrationChallenges = tableBody(sql, 'registration_challenges');
  addFailure(failures, has(registrationChallenges, /question_versions\s+integer\[\]\s+NOT\s+NULL/i), 'registration challenges must snapshot question versions');
  addFailure(failures, has(registrationChallenges, /cardinality\s*\(\s*question_versions\s*\)\s*=\s*cardinality\s*\(\s*question_ids\s*\)/i), 'challenge question ids and versions must have equal lengths');

  const sessionRevoker = functionBody(sql, 'revoke_user_session');
  addFailure(failures, has(sessionRevoker, /UPDATE\s+public\.user_sessions[\s\S]*?SET\s+revoked_at\s*=\s*clock_timestamp\(\)/i), 'session revoker must update the current session');
  addFailure(failures, has(sessionRevoker, /token_hash\s*=\s*p_token_hash[\s\S]*?revoked_at\s+IS\s+NULL/i), 'session revoker must match only the active current token');

  const idempotencyTable = tableBody(sql, 'idempotency_records');
  addFailure(failures, has(idempotencyTable, /PRIMARY\s+KEY\s*\(\s*scope\s*,\s*actor_scope_hash\s*,\s*idempotency_key\s*\)/i), 'idempotency records must be unique by scope, actor, and key');
  addFailure(failures, has(idempotencyTable, /response\s+jsonb/i), 'idempotency response must use jsonb');
  addFailure(failures, has(idempotencyTable, /status\s+text\s+NOT\s+NULL[\s\S]*?status\s+IN\s*\(\s*'processing'\s*,\s*'completed'\s*\)/i), 'idempotency status must be constrained');
  addFailure(failures, has(idempotencyTable, /status\s*=\s*'processing'\s+AND\s+response\s+IS\s+NULL[\s\S]*?status\s*=\s*'completed'\s+AND\s+response\s+IS\s+NOT\s+NULL/i), 'idempotency response must match record status');

  const beginIdempotency = functionBody(sql, 'begin_idempotent_request');
  addFailure(failures, has(beginIdempotency, /INSERT\s+INTO\s+public\.idempotency_records/i), 'idempotency begin must insert a processing record');
  addFailure(failures, has(beginIdempotency, /INSERT\s+INTO\s+public\.idempotency_records\s*\(\s*scope\s*,\s*actor_scope_hash\s*,\s*idempotency_key\s*,\s*request_hash\s*,\s*status\s*,\s*response\s*,\s*expires_at\s*\)[\s\S]*?VALUES\s*\(\s*p_scope\s*,\s*p_actor_scope_hash\s*,\s*p_idempotency_key\s*,\s*p_request_hash\s*,\s*'processing'\s*,\s*NULL\s*,\s*v_now\s*\+\s*interval\s*'5 minutes'\s*\)/i), 'idempotency processing lease must be five minutes');
  addFailure(failures, has(beginIdempotency, /ON\s+CONFLICT\s*\(\s*scope\s*,\s*actor_scope_hash\s*,\s*idempotency_key\s*\)\s+DO\s+UPDATE/i), 'idempotency begin must arbitrate the exact unique key');
  addFailure(failures, has(beginIdempotency, /DO\s+UPDATE\s+SET[\s\S]*?request_hash\s*=\s*EXCLUDED\.request_hash[\s\S]*?status\s*=\s*'processing'[\s\S]*?response\s*=\s*NULL[\s\S]*?WHERE\s+idempotency_records\.expires_at\s*<=\s*v_now/i), 'idempotency begin must atomically acquire expired records');
  addFailure(failures, has(beginIdempotency, /request_hash\s*<>\s*p_request_hash\s+THEN\s+'request_hash_conflict'/i), 'idempotency begin must detect request hash conflicts');
  addFailure(failures, has(beginIdempotency, /status\s*=\s*'completed'\s+THEN\s+'completed'/i), 'idempotency begin must replay completed requests');
  addFailure(failures, has(beginIdempotency, /ELSE\s+'in_progress'/i), 'idempotency begin must identify in-progress requests');
  addFailure(failures, has(beginIdempotency, /FOR\s+(?:NO\s+KEY\s+)?UPDATE/i), 'idempotency begin must lock the observed conflicting record');

  const completeIdempotency = functionBody(sql, 'complete_idempotent_request');
  addFailure(failures, has(completeIdempotency, /UPDATE\s+public\.idempotency_records[\s\S]*?SET\s+status\s*=\s*'completed'\s*,\s*response\s*=\s*p_response/i), 'idempotency complete must persist the response');
  addFailure(failures, has(completeIdempotency, /expires_at\s*=\s*clock_timestamp\(\)\s*\+\s*interval\s*'24 hours'/i), 'idempotency completion must extend replay retention to 24 hours');
  addFailure(failures, has(completeIdempotency, /request_hash\s*=\s*p_request_hash/i), 'idempotency complete must match the request hash');
  addFailure(failures, has(completeIdempotency, /status\s*=\s*'processing'/i), 'idempotency complete must only transition processing records');

  const failIdempotency = functionBody(sql, 'fail_idempotent_request');
  addFailure(failures, has(failIdempotency, /DELETE\s+FROM\s+public\.idempotency_records/i), 'idempotency fail must release the processing record');
  addFailure(failures, has(failIdempotency, /request_hash\s*=\s*p_request_hash/i), 'idempotency fail must match the request hash');
  addFailure(failures, has(failIdempotency, /status\s*=\s*'processing'/i), 'idempotency fail must only release processing records');

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
  const tableRevokeList = sql.match(/REVOKE\s+ALL\s+ON\s+TABLE\s+([\s\S]*?)\s+FROM\s+PUBLIC\s*;/i)?.[1] ?? '';
  for (const table of REQUIRED_TABLES) {
    addFailure(failures, new RegExp(`(?:^|,)\\s*public\\.${escapeRegExp(table)}\\s*(?:,|$)`, 'i').test(tableRevokeList), `PUBLIC table permissions must be revoked for ${table}`);
  }
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

  const appUsersTableGrantExpression = /GRANT\s+([^;]*?)\s+ON(?:\s+TABLE)?\s+([^;]*?)\s+TO\s+:"backend_role"\s*;/gi;
  const prohibitedAppUsersTablePrivileges = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  for (const match of sql.matchAll(appUsersTableGrantExpression)) {
    const includesAppUsers = match[2].split(',').some((tableReference) => publicTableName(tableReference) === 'app_users');
    if (!includesAppUsers) continue;

    const privilegeList = match[1].toUpperCase();
    if (/\bALL(?:\s+PRIVILEGES)?\b/.test(privilegeList)) {
      failures.push('app_users must not receive table-level ALL privileges');
    }
    for (const privilege of prohibitedAppUsersTablePrivileges) {
      const expression = privilege === 'UPDATE'
        ? /\bUPDATE\b(?!\s*\()/
        : new RegExp(`\\b${privilege}\\b`);
      if (expression.test(privilegeList)) {
        failures.push(`app_users must not receive table-level ${privilege} privileges`);
      }
    }
  }

  const tableGrants = new Map(REQUIRED_TABLES.map((table) => [table, new Set()]));
  const tableGrantExpression = /GRANT\s+((?:SELECT|INSERT|UPDATE|DELETE)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE))*)\s+ON(?:\s+TABLE)?\s+([^;]*?)\s+TO\s+:"backend_role"\s*;/gi;
  for (const match of sql.matchAll(tableGrantExpression)) {
    const operations = match[1].toUpperCase().split(/\s*,\s*/);
    for (const tableReference of match[2].split(',')) {
      const table = publicTableName(tableReference);
      if (tableGrants.has(table)) {
        for (const operation of operations) tableGrants.get(table).add(operation);
      }
    }
  }
  const appUsersUpdateGrants = [...sql.matchAll(/GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON(?:\s+TABLE)?\s+([^;]*?)\s+TO\s+:"backend_role"\s*;/gi)]
    .filter((match) => publicTableName(match[2]) === 'app_users');
  const appUsersUpdateColumns = appUsersUpdateGrants.flatMap((match) => match[1].split(',').map((column) => column.trim().toLowerCase()));
  const safeAppUserColumns = ['username', 'status', 'last_login_at'];
  addFailure(failures, appUsersUpdateGrants.length === 1 && appUsersUpdateColumns.length === safeAppUserColumns.length && safeAppUserColumns.every((column) => appUsersUpdateColumns.includes(column)), 'app_users update must be limited to profile/status/last-login columns');
  addFailure(failures, !appUsersUpdateColumns.some((column) => ['password_hash', 'role'].includes(column)), 'app_users update columns must not include password_hash or role');
  if (appUsersUpdateGrants.length === 1 && appUsersUpdateColumns.length === safeAppUserColumns.length && safeAppUserColumns.every((column) => appUsersUpdateColumns.includes(column))) {
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
  for (const [table, actualGrants] of tableGrants) {
    const expectedDefinition = RUNTIME_TABLE_GRANTS[table] ?? [];
    const expected = new Set(expectedDefinition.filter((item) => item !== 'UPDATE_COLUMNS'));
    if (expectedDefinition.includes('UPDATE_COLUMNS')) expected.add('UPDATE');
    for (const operation of actualGrants) {
      addFailure(failures, expected.has(operation), `runtime table grant exposes an undeclared ${operation} operation on ${table}`);
    }
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
