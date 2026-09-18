BEGIN;
REVOKE ALL ON TABLE public.legacy_identity_mappings, public.legacy_migration_credentials, public.backend_v2_migration_runs, public.backend_v2_migration_lock, public.legacy_entity_mappings, public.migration_public_asset_deletions, public.legacy_forum_entries, public.legacy_game_entries FROM :"backend_role";
GRANT EXECUTE ON FUNCTION public.begin_legacy_migration_claim(text,text,text) TO :"backend_role";
GRANT EXECUTE ON FUNCTION public.prepare_legacy_migration_credential(text,text,text) TO :"backend_role";
GRANT EXECUTE ON FUNCTION public.consume_legacy_migration_credential(text,text,text,text,text,timestamptz,text) TO :"backend_role";
COMMIT;
