BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.legacy_identity_mappings)
    OR EXISTS(SELECT 1 FROM public.legacy_migration_credentials)
    OR EXISTS(SELECT 1 FROM public.backend_v2_migration_runs)
    OR EXISTS(SELECT 1 FROM public.backend_v2_migration_lock)
    OR EXISTS(SELECT 1 FROM public.legacy_entity_mappings)
    OR EXISTS(SELECT 1 FROM public.migration_public_asset_deletions)
    OR EXISTS(SELECT 1 FROM public.legacy_forum_entries)
    OR EXISTS(SELECT 1 FROM public.legacy_game_entries)
    OR EXISTS(SELECT 1 FROM public.app_users WHERE credential_state='migration_required')
  THEN RAISE EXCEPTION 'backend_v2_cutover_rollback_requires_export_and_empty_tables'; END IF;
END $$;
DROP FUNCTION IF EXISTS public.begin_legacy_migration_claim(text,text,text);
DROP FUNCTION IF EXISTS public.assert_backend_v2_migration_context(text,text);
DROP FUNCTION IF EXISTS public.prepare_legacy_migration_credential(text,text,text);
DROP FUNCTION IF EXISTS public.consume_legacy_migration_credential(text,text,text,text,text,timestamptz,text);
DROP FUNCTION IF EXISTS public.claim_backend_v2_migration_lock(uuid,integer);
DROP FUNCTION IF EXISTS public.release_backend_v2_migration_lock(uuid);
DROP FUNCTION IF EXISTS public.begin_backend_v2_migration_run(text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.apply_backend_v2_migration_batch(uuid,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.validate_migrated_work_publication(uuid,text,boolean);
DROP FUNCTION IF EXISTS public.collect_backend_v2_check(uuid);
DROP FUNCTION IF EXISTS public.collect_backend_v2_snapshot_manifest();
DROP FUNCTION IF EXISTS public.export_backend_v2_credential_envelopes(uuid);
DROP FUNCTION IF EXISTS public.claim_public_asset_deletion(uuid,text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.finalize_public_asset_deletion(uuid,text,text,bigint);
DROP TABLE public.migration_public_asset_deletions;
DROP TABLE public.legacy_entity_mappings;
DROP TABLE public.backend_v2_migration_lock;
DROP TABLE public.backend_v2_migration_context;
DROP TABLE public.legacy_game_entries;
DROP TABLE public.legacy_forum_entries;
DROP TABLE public.legacy_migration_credentials;
DROP TABLE public.backend_v2_migration_runs;
DROP TABLE public.legacy_identity_mappings;
ALTER TABLE public.app_users DROP CONSTRAINT app_users_credential_state_check;
ALTER TABLE public.app_users DROP CONSTRAINT app_users_credential_password_check;
ALTER TABLE public.app_users DROP COLUMN credential_state;
ALTER TABLE public.app_users ALTER COLUMN password_hash SET NOT NULL;
COMMIT;
