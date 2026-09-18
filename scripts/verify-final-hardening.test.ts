import { readFileSync } from 'node:fs';import{resolve}from'node:path';import{describe,expect,it}from'vitest';import{validateFinalHardening}from'./verify-final-hardening.mjs';
const root=resolve(import.meta.dirname,'..');const files=()=>({runtime:readFileSync(resolve(root,'cloudbase/functions/app-api/index.js'),'utf8'),legacy:readFileSync(resolve(root,'cloudbase/functions/app-api/src/compat/legacy-users.js'),'utf8'),auth:readFileSync(resolve(root,'cloudbase/functions/app-api/src/modules/auth/service.js'),'utf8'),userEntry:readFileSync(resolve(root,'src/components/UserEntry.tsx'),'utf8'),legacyPage:readFileSync(resolve(root,'src/features/auth/LegacyMigrationPage.tsx'),'utf8'),base:readFileSync(resolve(root,'cloudbase/migrations/20260918_backend_v2.sql'),'utf8'),rollback:readFileSync(resolve(root,'cloudbase/migrations/20260918_backend_v2_rollback.sql'),'utf8'),admin:readFileSync(resolve(root,'cloudbase/functions/app-api/src/modules/admin-console/service.js'),'utf8')});
describe('final hardening verifier',()=>{it('accepts the hardened design',()=>expect(validateFinalHardening(files())).toEqual([]));it.each([
 ['pepper injection','runtime',(s:string)=>s.replace('authPepper: config.authHashPepper','authPepper: config.migrationHashPepper')],
 ['pepper domain','legacy',(s:string)=>s.replace("authHash('session'","migrationHash('session'")],
 ['client expiry','auth',(s:string)=>`${s}\nconst sessionExpiresAt='client';`],
 ['recovery storage','userEntry',(s:string)=>`${s}\nwindow.sessionStorage.setItem('recovery','x');`],
 ['legacy recovery cleanup','legacyPage',(s:string)=>s.replace("sessionStorage.removeItem('levihan.pendingRecoveryCode')",'')],
 ['admin password','admin',(s:string)=>s.replace('passwordHasher.verify(credential.passwordHash','passwordHasher.verify(target.passwordHash')],
 ['rollback lock','rollback',(s:string)=>s.replace('ACCESS EXCLUSIVE MODE','SHARE MODE')],
])('rejects %s',(_name,key,mutate)=>{const value=files();value[key as keyof typeof value]=mutate(value[key as keyof typeof value]);expect(validateFinalHardening(value).length).toBeGreaterThan(0);});});
