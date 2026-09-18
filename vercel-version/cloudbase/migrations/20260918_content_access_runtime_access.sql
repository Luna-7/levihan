\if :{?backend_role}
\else
\echo 'backend_role is required; pass -v backend_role=your_backend_role'
\quit 3
\endif

BEGIN;

REVOKE INSERT,UPDATE,DELETE ON TABLE public.age_consents FROM :"backend_role";
REVOKE ALL ON TABLE public.content_access_authorizations,public.restricted_access_controls FROM :"backend_role";
GRANT EXECUTE ON FUNCTION public.resolve_content_user_session(text),public.get_current_age_policy(),public.set_age_consent(uuid,text,text),
  public.revoke_age_consent(uuid,text),public.authorize_work_access(uuid,uuid,uuid),public.finalize_work_access(uuid,uuid,uuid,uuid),
  public.set_restricted_access_control(uuid,uuid,text,text,text)
  ,public.get_public_restricted_access_id(text),public.get_public_work(text)
TO :"backend_role";

COMMIT;
