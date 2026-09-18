BEGIN;
REVOKE EXECUTE ON FUNCTION public.assert_backend_v2_migration_context(text,text), public.claim_backend_v2_migration_lock(uuid,integer), public.release_backend_v2_migration_lock(uuid), public.begin_backend_v2_migration_run(text,text,text,text,jsonb), public.apply_backend_v2_migration_batch(uuid,text,text,text,text,jsonb), public.collect_backend_v2_check(uuid), public.collect_backend_v2_snapshot_manifest(), public.export_backend_v2_credential_envelopes(uuid), public.claim_public_asset_deletion(uuid,text,text,text,text,text,text), public.finalize_public_asset_deletion(uuid,text,text,bigint) FROM :"migration_role";
DELETE FROM public.backend_v2_migration_context WHERE singleton AND allowed_role::text=:'migration_role';
COMMIT;
