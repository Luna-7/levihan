# PostgreSQL migrations

`20260918_backend_v2.sql` is an additive v2 schema migration. It does not
rename, alter, or remove the incompatible legacy `public.users` table; v2
identity lives in `public.app_users`. It also leaves the prior
`public.submission_inbox` migration alone.

The database is server-only. Every v2 table has RLS enabled and `PUBLIC` is
revoked; the migration deliberately grants no unknown role. Provision a
separate backend database role outside this file with only the table/function
privileges and RLS policies required by the CloudBase API. Browser clients must
never receive that credential. Session tokens, registration tickets, and
recovery codes are stored only as hashes.

## Production runbook

1. Confirm CloudBase automated backups are current, and make an encrypted
   logical backup. Keep the backup identifier in the deployment record.
2. In an isolated staging or temporary PostgreSQL database, apply the legacy
   schema first, then preview and execute this migration with the same engine
   version. Do not use a production connection for tests.
3. Run `npm run verify:backend-schema`; it is an offline static contract check,
   not a database mutation.
4. During the approved maintenance window, execute
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f cloudbase/migrations/20260918_backend_v2.sql`
   using a server-side administrative connection. Verify `pgcrypto`, all v2
   tables, RLS state, and the atomic routines before API deployment.
5. Deploy the API with its newly provisioned least-privilege backend role,
   then test registration, cookie session rotation, recovery-code replay,
   idempotent interactions, upload confirmation, and snapshot jobs against a
   non-production account.

## Rollback

Prefer a forward fix after any write has reached the v2 tables. If the
migration must be rolled back before v2 traffic is enabled, execute
`20260918_backend_v2_rollback.sql` with `ON_ERROR_STOP=1`. It drops only the
objects created by this migration and intentionally keeps `pgcrypto`, legacy
`public.users`, and existing `public.submission_inbox` intact. Restore the
pre-migration backup rather than using rollback after v2 data has been written.
