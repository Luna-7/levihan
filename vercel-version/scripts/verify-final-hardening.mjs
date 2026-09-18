import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(import.meta.dirname,'..');
const add=(failures,condition,message)=>{if(!condition)failures.push(message);};
export function validateFinalHardening({runtime,legacy,auth,userEntry,legacyPage,base,rollback,admin}){const failures=[];
  add(failures,/migrationPepper:\s*config\.migrationHashPepper,\s*authPepper:\s*config\.authHashPepper/.test(runtime),'runtime must inject distinct migration and auth peppers');
  for(const domain of ['legacy-migration-credential','legacy-migration-claim','legacy-migration-prepare']) add(failures,new RegExp(`migrationHash\\('${domain}'`).test(legacy),`migration domain ${domain} must use migration pepper`);
  for(const domain of ['session','recovery-code','ip']) add(failures,new RegExp(`authHash\\('${domain}'`).test(legacy),`auth domain ${domain} must use auth pepper`);
  add(failures,!/domainHash\(pepper|authHash\('legacy-migration|migrationHash\('(session|recovery-code|ip)'/.test(legacy),'legacy service must not mix pepper domains');
  add(failures,!/sessionExpiresAt/.test(auth)&&!/p_session_expires_at|p_expires_at/.test(auth),'auth service must not choose session expiry');
  const storageReadOrWrite=/\b(?:localStorage|sessionStorage)\.(?:setItem|getItem)/;
  add(failures,!storageReadOrWrite.test(userEntry)&&!storageReadOrWrite.test(legacyPage),'recovery codes must remain in React memory only');
  for(const source of [userEntry,legacyPage]) add(failures,/sessionStorage\.removeItem\('levihan\.pendingRecoveryCode'\)/.test(source),'legacy recovery-code storage residue must be deleted without reading it');
  add(failures,/CREATE FUNCTION public\.regenerate_unconfirmed_recovery_code/.test(base)&&/auth\.recovery\.regenerate/.test(base),'unconfirmed recovery regeneration must be atomic and audited');
  add(failures,/interval '8 hours'/.test(base)&&/interval '30 days'/.test(base),'database must derive role-based session expiry');
  add(failures,/LOCK TABLE public\.app_users[\s\S]*ACCESS EXCLUSIVE MODE/.test(rollback)&&/rollback_requires_backend_v2_backup_restore/.test(rollback),'base rollback must lock and fail closed on data');
  add(failures,/passwordHasher\.verify\(credential\.passwordHash/.test(admin)&&/domainHash\(authPepper,'admin-reauth'/.test(admin),'admin promotion must verify actor password and bind a server nonce');
  return failures;}
export function verifyFinalHardening(){return validateFinalHardening({runtime:readFileSync(resolve(root,'cloudbase/functions/app-api/index.js'),'utf8'),legacy:readFileSync(resolve(root,'cloudbase/functions/app-api/src/compat/legacy-users.js'),'utf8'),auth:readFileSync(resolve(root,'cloudbase/functions/app-api/src/modules/auth/service.js'),'utf8'),userEntry:readFileSync(resolve(root,'src/components/UserEntry.tsx'),'utf8'),legacyPage:readFileSync(resolve(root,'src/features/auth/LegacyMigrationPage.tsx'),'utf8'),base:readFileSync(resolve(root,'cloudbase/migrations/20260918_backend_v2.sql'),'utf8'),rollback:readFileSync(resolve(root,'cloudbase/migrations/20260918_backend_v2_rollback.sql'),'utf8'),admin:readFileSync(resolve(root,'cloudbase/functions/app-api/src/modules/admin-console/service.js'),'utf8')});}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||'')).href){const failures=verifyFinalHardening();if(failures.length){console.error(`final hardening verification failed:\n- ${failures.join('\n- ')}`);process.exitCode=1;}else console.log('final authentication and rollback hardening verification passed');}
