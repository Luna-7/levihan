# PostgreSQL migrations

`20260918_backend_v2.sql` is an additive v2 schema migration. It does not
rename, alter, or remove the incompatible legacy `public.users` table; v2
identity lives in `public.app_users`. It also leaves the prior
`public.submission_inbox` migration alone. The schema migration and
`20260918_backend_v2_runtime_access.sql` are one release unit: apply both, in
that order, before deploying an API that uses v2.

The database is server-only. Every v2 table has RLS enabled and `PUBLIC` is
revoked; the migration deliberately grants no unknown role. Provision a
separate backend database role outside this file with only the table/function
privileges and RLS policies required by the CloudBase API. Browser clients must
never receive that credential. Session tokens, registration tickets, and
recovery codes are stored only as hashes.

`backend_role` is still a high-trust service/API identity, not a user
authorization boundary: the API must authenticate the caller and enforce
user-level ownership before issuing a query. The runtime script grants
read-only access to session/security state and append-only access to versions,
snapshots, moderation actions, and audit logs; state-changing security writes
(login-session creation, session rotation, registration/recovery consumption,
likes, favorites, and reading progress) are exposed only through the explicitly
granted `SECURITY DEFINER` routines. `promote_app_user` is likewise the only
admin-promotion path: it requires an active admin actor, reauthentication, an
active target, and an audit request id; there is no database demotion or user
deletion workflow. Question-bank CRUD is available only to this protected
service role, with the API enforcing the admin guard. The migration itself must
be executed by its owner (or an equivalent deployment administrator) before the
runtime grants are installed.

## Production runbook

1. Confirm CloudBase automated backups are current, and make an encrypted
   logical backup. Keep the backup identifier in the deployment record. Create
   or provision the least-privilege `backend_role` separately; this migration
   must not invent a role or embed a credential.
2. In an isolated staging or temporary PostgreSQL database, apply the legacy
   schema first, then preview and execute both v2 files with the same engine
   version. Do not use a production connection for tests. The required order is:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f cloudbase/migrations/20260918_backend_v2.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v backend_role=backend_role \
     -f cloudbase/migrations/20260918_backend_v2_runtime_access.sql
   ```

3. Run `npm run verify:backend-schema`; it is an offline static contract check,
   not a database mutation. Then inspect the disposable database for every v2
   table's RLS state, `PUBLIC` revocations, runtime-role grants, policies, and
   all atomic routines.
4. Before production, run a rollback drill in that isolated database: apply
   both files, verify an empty v2 deployment, and execute the rollback file
   with `-v ON_ERROR_STOP=1`. Separately run a concurrency drill with two or
   more clients racing the same registration challenge, registration ticket,
   recovery code, and upload binding; exactly one consumer must win. Repeat
   the drill after restoring the backup snapshot if the disposable database
   cannot be reset cleanly.
5. During the approved maintenance window, execute the same two commands
   against production using a server-side administrative connection. Verify
   `pgcrypto`, all v2 tables, RLS state, the runtime role's grants/policies,
   and the atomic routines before API deployment.
6. Deploy the API only after runtime access is installed, then test
   registration, cookie session rotation, recovery-code replay, idempotent
   interactions, upload confirmation, and snapshot jobs against a
   non-production account.

## Rollback

Prefer a forward fix after any write has reached the v2 tables. If the
migration must be rolled back before v2 traffic is enabled, execute
`20260918_backend_v2_rollback.sql` with `ON_ERROR_STOP=1`. It drops only the
objects created by this migration and intentionally keeps `pgcrypto`, legacy
`public.users`, and existing `public.submission_inbox` intact. Restore the
pre-migration backup rather than using rollback after v2 data has been written.
