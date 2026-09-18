BEGIN;
INSERT INTO public.backend_v2_migration_context(singleton,environment,allowed_role)
VALUES(true, :'environment', :'migration_role')
ON CONFLICT(singleton) DO UPDATE SET environment=excluded.environment,allowed_role=excluded.allowed_role,configured_at=clock_timestamp();
GRANT USAGE ON SCHEMA public TO :"migration_role";
REVOKE ALL ON TABLE public.app_users,public.works,public.work_chapters,public.work_assets,public.comments,public.snapshot_jobs,public.snapshot_versions,public.snapshot_current,public.audit_logs,public.user_sessions,public.recovery_codes,public.legacy_identity_mappings,public.legacy_migration_credentials,public.backend_v2_migration_runs,public.backend_v2_migration_lock,public.backend_v2_migration_context,public.legacy_entity_mappings,public.migration_public_asset_deletions,public.legacy_forum_entries,public.legacy_game_entries FROM :"migration_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"migration_role";
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM :"migration_role";
GRANT EXECUTE ON FUNCTION public.assert_backend_v2_migration_context(text,text), public.claim_backend_v2_migration_lock(uuid,integer), public.release_backend_v2_migration_lock(uuid), public.begin_backend_v2_migration_run(text,text,text,text,jsonb), public.apply_backend_v2_migration_batch(uuid,text,text,text,text,jsonb), public.collect_backend_v2_check(uuid), public.collect_backend_v2_snapshot_manifest(), public.export_backend_v2_credential_envelopes(uuid), public.claim_public_asset_deletion(uuid,text,text,text,text,text,text), public.finalize_public_asset_deletion(uuid,text,text,bigint) TO :"migration_role";
COMMIT;
