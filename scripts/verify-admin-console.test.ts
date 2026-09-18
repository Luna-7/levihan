import { readFileSync } from 'node:fs'; import { resolve } from 'node:path'; import { describe,expect,it } from 'vitest'; import { validateAdminConsole } from './verify-admin-console.mjs';
const root=resolve(import.meta.dirname,'..'); const files=()=>({migration:readFileSync(resolve(root,'cloudbase/migrations/20260918_admin_console.sql'),'utf8'),rollback:readFileSync(resolve(root,'cloudbase/migrations/20260918_admin_console_rollback.sql'),'utf8'),access:readFileSync(resolve(root,'cloudbase/migrations/20260918_admin_console_runtime_access.sql'),'utf8'),accessRollback:readFileSync(resolve(root,'cloudbase/migrations/20260918_admin_console_runtime_access_rollback.sql'),'utf8'),routes:readFileSync(resolve(root,'cloudbase/functions/app-api/src/modules/admin-console/routes.js'),'utf8'),runtime:readFileSync(resolve(root,'cloudbase/functions/app-api/index.js'),'utf8'),app:readFileSync(resolve(root,'src/admin/AdminApp.tsx'),'utf8'),api:readFileSync(resolve(root,'src/admin/api.ts'),'utf8'),vite:readFileSync(resolve(root,'vite.config.ts'),'utf8'),legacy:readFileSync(resolve(root,'public/admin/index.html'),'utf8')});
describe('admin console verifier',()=>{it('accepts controlled console',()=>expect(validateAdminConsole(files())).toEqual([]));it.each([
 ['session binding',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('interaction_assert_admin(p_admin_id,p_admin_session_id)','interaction_assert_admin(p_admin_id,NULL)');}],
 ['idempotency',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('admin_console_operations','removed_operations');}],
 ['idempotency concurrency',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace("pg_advisory_xact_lock(hashtextextended('admin-console:'||p_actor_id::text||':'||p_key,20260918))",'');}],
 ['CAS',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('target.version<>p_expected_version','false');}],
 ['immutable question',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('old.version+1','old.version');}],
 ['latest question lock',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace("pg_advisory_xact_lock(hashtextextended('question:'||old.question_key::text,20260918))",'');}],
 ['status CAS version',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('q.version+1','q.version');}],
 ['last admin',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('last_active_admin','removed');}],
 ['cleanup CAS',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('file.cleanup_admin_version<>p_expected_version','false');}],
 ['user session projection',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('active_sessions','removed_sessions');}],
 ['dashboard health',(v:ReturnType<typeof files>)=>{v.migration=v.migration.replace('storageHealth','removedHealth');}],
 ['runtime grant',(v:ReturnType<typeof files>)=>{v.access=v.access.replace('public.admin_dashboard_v2(uuid,uuid),','');}],
 ['runtime rollback',(v:ReturnType<typeof files>)=>{v.accessRollback=v.accessRollback.replace('public.admin_dashboard_v2(uuid,uuid),','');}],
 ['rollback fence',(v:ReturnType<typeof files>)=>{v.rollback=v.rollback.replace('rollback_requires_admin_console_export','removed');}],
 ['route auth',(v:ReturnType<typeof files>)=>{v.routes=v.routes.replaceAll("role: 'admin'", "role: 'member'");}],
 ['legacy secret',(v:ReturnType<typeof files>)=>{v.legacy+='<input type=password>'; }],
 ['multipage',(v:ReturnType<typeof files>)=>{v.vite=v.vite.replace("admin: path.resolve(__dirname, 'admin.html')",'');}],
])('rejects mutation: %s',(_name,mutate)=>{const value=files();mutate(value);expect(validateAdminConsole(value).length).toBeGreaterThan(0);});});
