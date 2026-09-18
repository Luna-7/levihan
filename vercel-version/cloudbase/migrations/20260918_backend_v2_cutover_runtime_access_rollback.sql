BEGIN;
REVOKE EXECUTE ON FUNCTION public.begin_legacy_migration_claim(text,text,text) FROM :"backend_role";
REVOKE EXECUTE ON FUNCTION public.prepare_legacy_migration_credential(text,text,text) FROM :"backend_role";
REVOKE EXECUTE ON FUNCTION public.consume_legacy_migration_credential(text,text,text,text,text,text) FROM :"backend_role";
COMMIT;
