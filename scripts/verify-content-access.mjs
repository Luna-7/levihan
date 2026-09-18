import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripSqlComments } from './verify-backend-schema.mjs';

const root = resolve(import.meta.dirname, '..');
const ROUTINES = [
  ['get_current_age_policy', ''], ['resolve_content_user_session', 'text'],
  ['set_age_consent', 'uuid,text,text'], ['revoke_age_consent', 'uuid,text'],
  ['authorize_work_access', 'uuid,uuid,uuid'], ['finalize_work_access', 'uuid,uuid,uuid,uuid'],
  ['set_restricted_access_control', 'uuid,uuid,text,text,text'], ['get_public_restricted_access_id', 'text'],
];
const compact = (value) => value.replace(/\s+/g, '').toLowerCase();
const add = (failures, condition, message) => { if (!condition) failures.push(message); };
function routine(sql, name) { return sql.match(new RegExp(`CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] || ''; }

export function validateContentAccess({ migration, rollback, access, accessRollback, cosSource, serviceSource, swSource, pageSource, routerSource, mainSource }) {
  const failures = [];
  const sql = stripSqlComments(migration); const down = stripSqlComments(rollback); const grants = stripSqlComments(access); const grantDown = stripSqlComments(accessRollback);
  add(failures, /^BEGIN;/i.test(sql.trim()) && /COMMIT;\s*$/i.test(sql.trim()), 'migration transaction required');
  add(failures, /^BEGIN;/i.test(down.trim()) && /COMMIT;\s*$/i.test(down.trim()), 'rollback transaction required');
  add(failures, /CREATE\s+TABLE\s+public\.content_access_authorizations/i.test(sql) && /status\s+text[\s\S]*?'pending'[\s\S]*?'issued'[\s\S]*?'denied'/i.test(sql), 'two-phase authorization table required');
  add(failures, /ALTER\s+TABLE\s+public\.content_access_authorizations\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'authorization RLS required');
  add(failures, /session_id\s+uuid\s+NOT\s+NULL[\s\S]*?work_version\s+bigint\s+NOT\s+NULL[\s\S]*?asset_set_hash\s+text\s+NOT\s+NULL/i.test(sql), 'authorization must bind session, work version and asset set hash');
  add(failures, /content_access_authorizations_session_idx[\s\S]*?\(session_id\s*,\s*expires_at\)/i.test(sql), 'session authorization index required');
  add(failures, /CREATE\s+TABLE\s+public\.restricted_access_controls/i.test(sql) && /ALTER\s+TABLE\s+public\.restricted_access_controls\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'persistent restricted access control with RLS required');
  for (const [name, signature] of ROUTINES) {
    const definition = routine(sql, name);
    add(failures, Boolean(definition), `missing routine ${name}`);
    add(failures, /SECURITY\s+DEFINER/i.test(definition) && /SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i.test(definition), `${name} must pin definer search_path`);
    add(failures, compact(sql).includes(compact(`REVOKE EXECUTE ON FUNCTION public.${name}(${signature}) FROM PUBLIC;`)), `${name} public execute revoke missing`);
    add(failures, compact(grants).includes(compact(`public.${name}(${signature})`)), `${name} runtime execute grant missing`);
    add(failures, compact(down).includes(compact(`DROP FUNCTION IF EXISTS public.${name}(${signature});`)), `${name} rollback drop missing`);
  }
  const resolver = routine(sql, 'resolve_content_user_session'); const consent = routine(sql, 'set_age_consent'); const authorize = routine(sql, 'authorize_work_access'); const finalize = routine(sql, 'finalize_work_access'); const control = routine(sql, 'set_restricted_access_control'); const manifest = routine(sql, 'content_access_asset_manifest'); const equal = routine(sql, 'content_access_constant_time_equal'); const publicWork = routine(sql, 'get_public_work');
  add(failures, /RETURNS\s+TABLE\s*\(\s*user_id\s+uuid\s*,\s*role\s+text\s*,\s*session_id\s+uuid/i.test(resolver)
    && /session\.revoked_at\s+IS\s+NULL/i.test(resolver) && /session\.expires_at\s*>\s*clock_timestamp/i.test(resolver)
    && /session\.recovery_confirmed_at\s+IS\s+NOT\s+NULL/i.test(resolver) && /app_user\.recovery_confirmed_at\s+IS\s+NOT\s+NULL/i.test(resolver), 'session resolver must safely return and validate the exact session');
  add(failures, /FOR\s+NO\s+KEY\s+UPDATE/i.test(consent) && /FOR\s+UPDATE/i.test(consent), 'consent must serialize user and same-version records');
  add(failures, /existing_accepted\s+IS\s+NOT\s+NULL[\s\S]*?RETURN\s+QUERY/i.test(consent), 'same-version consent must be audit-idempotent');
  add(failures, /INSERT\s+INTO\s+public\.audit_logs/i.test(consent) && /age_consent\.accept/i.test(consent) && /age_consent\.revoke/i.test(routine(sql, 'revoke_age_consent')), 'consent changes must be audited');
  add(failures, /asset\.storage_zone\s*=\s*'private'/i.test(manifest) && /asset\.access_level\s*=\s*'private'/i.test(manifest) && /asset\.status\s*=\s*'active'/i.test(manifest), 'authorization must select only active private/private assets');
  add(failures, /starts_with\s*\(\s*asset\.object_key\s*,\s*'protected\/works\/'\s*\|\|\s*p_work_id::text\s*\|\|\s*'\/'\s*\)/i.test(manifest), 'authorization must enforce work-bound protected prefix');
  add(failures, /jsonb_build_object\([\s\S]*?'id'[\s\S]*?'object_key'[\s\S]*?'checksum'[\s\S]*?'kind'[\s\S]*?'mime_type'[\s\S]*?'page_no'[\s\S]*?'chapter_id'[\s\S]*?'chapter_position'/i.test(manifest)
    && /ORDER\s+BY\s+COALESCE\(chapter\.position,0\),COALESCE\(asset\.page_no,0\),asset\.kind,asset\.id/i.test(manifest), 'canonical asset manifest fields and ordering required');
  add(failures, /FOR\s+position\s+IN\s+0\.\.31\s+LOOP/i.test(equal) && /get_byte\(left_bytes,position\)\s*#\s*get_byte\(right_bytes,position\)/i.test(equal), 'asset hashes require constant-time comparison');
  add(failures, /FOR\s+NO\s+KEY\s+UPDATE/i.test(authorize) && /FOR\s+SHARE/i.test(authorize), 'authorization must lock account, work, setting and consent snapshot');
  add(failures, !/DELETE\s+FROM\s+public\.content_access_authorizations/i.test(authorize), 'authorization must not lock unrelated authorization rows before its account lock');
  add(failures, /session_id,work_id,work_version,asset_set_hash/i.test(authorize) && /p_session_id,p_work_id,work\.version,manifest_hash/i.test(authorize), 'authorization must persist exact session and asset snapshot');
  add(failures, /session\.revoked_at\s+IS\s+NOT\s+NULL/i.test(authorize) && /session\.recovery_confirmed_at\s+IS\s+NULL/i.test(authorize), 'authorization must reject revoked or recovery-invalid session');
  add(failures, /authorization\.status\s*<>\s*'pending'/i.test(finalize) && /FOR\s+UPDATE/i.test(finalize) && /status\s*=\s*'issued'/i.test(finalize), 'final issuance must fence a pending authorization');
  add(failures, /session_id\s*=\s*p_session_id/i.test(finalize) && /session\.revoked_at\s+IS\s+NOT\s+NULL/i.test(finalize) && /session\.expires_at\s*<=\s*clock_timestamp/i.test(finalize), 'final issuance must bind and recheck exact session');
  add(failures, /app_user\.status\s*<>\s*'active'/i.test(finalize) && /work\.status\s*<>\s*'published'/i.test(finalize) && /authorization\.policy_version\s+IS\s+DISTINCT\s+FROM\s+policy/i.test(finalize), 'final issuance must recheck account, publication and consent version');
  add(failures, /work\.version\s*<>\s*authorization\.work_version/i.test(finalize) && /content_access_constant_time_equal\(manifest_hash,authorization\.asset_set_hash\)/i.test(finalize), 'final issuance must recheck work version and canonical asset set');
  add(failures, /admin\.role\s*<>\s*'admin'/i.test(control) && /admin\.status\s*<>\s*'active'/i.test(control) && /restricted_access\.'\|\|p_action/i.test(control)
    && /UPDATE\s+public\.content_access_authorizations\s+SET\s+status='denied'/i.test(control), 'admin restriction control must validate admin, audit and invalidate pending grants');
  add(failures, /restricted_access_controls/i.test(authorize) && /restricted_access_controls/i.test(finalize), 'authorization phases must enforce persistent admin restriction');
  add(failures, /work\.rating\s*=\s*'restricted'[\s\S]*?THEN\s*'\[\]'::jsonb/i.test(publicWork), 'restricted public metadata must omit chapters');
  add(failures, /work\.rating\s*<>\s*'restricted'\s+OR\s+asset\.kind\s*=\s*'preview'/i.test(publicWork) && !/asset\.kind\s+IN\s*\(\s*'cover'/i.test(publicWork), 'restricted public visuals must be explicit previews only');
  add(failures, /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+TABLE\s+public\.age_consents/i.test(grants)
    && /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.content_access_authorizations\s*,\s*public\.restricted_access_controls/i.test(grants), 'runtime direct authorization DML must be revoked');
  add(failures, !/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE))*\s+ON\s+TABLE\s+public\.(?:content_access_authorizations|restricted_access_controls)/i.test(grants), 'runtime cannot receive direct authorization table grants');
  add(failures, /GRANT\s+INSERT\s*,\s*UPDATE\s+ON\s+TABLE\s+public\.age_consents/i.test(grantDown), 'runtime rollback must restore prior age consent grants');
  add(failures, /work\.rating\s*<>\s*'restricted'/i.test(routine(down, 'get_public_work')), 'rollback must restore Task5 public work policy');
  add(failures, /DROP\s+TABLE\s+IF\s+EXISTS\s+public\.content_access_authorizations/i.test(down), 'rollback must remove authorization table');
  add(failures, /DROP\s+TABLE\s+IF\s+EXISTS\s+public\.restricted_access_controls/i.test(down), 'rollback must remove restriction control table');
  const signGet = cosSource.match(/async\s+signGet\s*\([\s\S]*?\n\s*},\n\s*async\s+signPut/i)?.[0] || '';
  add(failures, /expiresInSeconds\s*!==\s*300/i.test(signGet) && /Bucket:\s*privateBucket/i.test(signGet) && /Method:\s*'GET'/i.test(signGet) && /protected\\\/works/i.test(signGet)
    && /expectedHost:\s*`\$\{privateBucket\}\.cos\.\$\{region\}\.myqcloud\.com`/i.test(signGet) && /validateSignedReadUrl/i.test(signGet), 'COS GET signing must be five-minute private protected non-website access');
  add(failures, /parsed\.protocol\s*!==\s*'https:'/.test(cosSource) && /parsed\.username/.test(cosSource) && /parsed\.password/.test(cosSource) && /parsed\.port/.test(cosSource) && /parsed\.hash/.test(cosSource)
    && /q-sign-algorithm/.test(cosSource) && /q-sign-time/.test(cosSource) && /q-key-time/.test(cosSource) && /q-signature/.test(cosSource)
    && /\^\[a-f0-9\]\{40\}\$[\s\S]*?parsed\.searchParams\.get\('q-signature'\)/.test(cosSource)
    && /end\s*-\s*start\s*>\s*300/.test(cosSource) && /new\s+Date\(end\s*\*\s*1000\)/.test(cosSource), 'COS signed URL fields, authority, time window and derived expiry must be verified');
  add(failures, /private,\s*no-store,\s*max-age=0/i.test(serviceSource) && /pragma:\s*'no-cache'/i.test(serviceSource) && /'referrer-policy':\s*'no-referrer'/i.test(serviceSource), 'signed response must be non-cacheable');
  add(failures, /finalizeWorkAccess/i.test(serviceSource) && /if\s*\(!final\.allowed\)\s*throw/i.test(serviceSource), 'signed URLs must not return before final authorization');
  add(failures, /urlPattern:\s*isRestrictedRequest[\s\S]*?handler:\s*'NetworkOnly'/i.test(swSource)
    && /urlPattern:\s*\/\^\\\/api\\\/v1\\\/works[\s\S]*?handler:\s*'NetworkOnly'[\s\S]*?method:\s*'POST'/i.test(swSource), 'restricted GET assets and POST access responses must be NetworkOnly');
  add(failures, /getPublicWork\(slug\)/.test(pageSource || '') && /getAgePolicy\(\)/.test(pageSource || '') && /<AgeGate/.test(pageSource || '')
    && /setAccess\(null\)/.test(pageSource || '') && !/(?:localStorage|sessionStorage)/.test(pageSource || ''), 'restricted reader must use the real APIs and keep signed access in memory');
  add(failures, /#\\\/restricted\\\//.test(routerSource || '') && /RestrictedWorkPage/.test(routerSource || '') && /<RootRouter\s*\/>/.test(mainSource || ''), 'restricted reader must be reachable from the application root');
  return failures;
}

export function verifyContentAccessFromFiles() {
  return validateContentAccess({
    migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access.sql'), 'utf8'), rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access_rollback.sql'), 'utf8'),
    access: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access_runtime_access.sql'), 'utf8'), accessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_access_runtime_access_rollback.sql'), 'utf8'),
    cosSource: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/infrastructure/cos.js'), 'utf8'), serviceSource: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/modules/access/service.js'), 'utf8'), swSource: readFileSync(resolve(root, 'vite.config.ts'), 'utf8'),
    pageSource: readFileSync(resolve(root, 'src/features/access/RestrictedWorkPage.tsx'), 'utf8'), routerSource: readFileSync(resolve(root, 'src/RootRouter.tsx'), 'utf8'), mainSource: readFileSync(resolve(root, 'src/main.tsx'), 'utf8'),
  });
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  const failures = verifyContentAccessFromFiles();
  if (failures.length) { console.error(`content access verification failed:\n- ${failures.join('\n- ')}`); process.exitCode = 1; }
  else console.log('content access static verification passed');
}
