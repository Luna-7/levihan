\if :{?backend_role}
\else
\echo 'backend_role is required; pass -v backend_role=your_backend_role'
\quit 3
\endif

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_current_age_policy(),public.set_age_consent(uuid,text,text),
  public.revoke_age_consent(uuid,text),public.authorize_work_access(uuid,uuid,text),public.finalize_work_access(uuid,uuid,uuid)
  ,public.get_public_restricted_access_id(text)
FROM :"backend_role";
GRANT INSERT,UPDATE ON TABLE public.age_consents TO :"backend_role";
GRANT EXECUTE ON FUNCTION public.get_public_work(text) TO :"backend_role";

COMMIT;
