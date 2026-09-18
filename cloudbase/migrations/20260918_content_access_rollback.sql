BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_work(p_slug text)
RETURNS TABLE (slug text, type text, title text, summary text, rating text, author_name text, published_at timestamptz, chapters jsonb, assets jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT work.slug,work.type,work.title,work.summary,work.rating,work.author_name,work.published_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',chapter.title,'position',chapter.position) ORDER BY chapter.position) FROM public.work_chapters AS chapter WHERE chapter.work_id=work.id AND chapter.status='published'),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('chapter_position',chapter.position,'kind',asset.kind,'object_key',asset.object_key,'page_no',asset.page_no) ORDER BY COALESCE(chapter.position,0),COALESCE(asset.page_no,0),asset.id)
      FROM public.work_assets AS asset LEFT JOIN public.work_chapters AS chapter ON chapter.id=asset.chapter_id
      WHERE asset.work_id=work.id AND asset.status='active' AND asset.access_level='public' AND asset.storage_zone='public'),'[]'::jsonb)
  FROM public.works AS work WHERE work.slug=p_slug AND work.status='published' AND work.rating <> 'restricted';
$$;

DROP FUNCTION IF EXISTS public.finalize_work_access(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.get_public_restricted_access_id(text);
DROP FUNCTION IF EXISTS public.authorize_work_access(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.revoke_age_consent(uuid,text);
DROP FUNCTION IF EXISTS public.set_age_consent(uuid,text,text);
DROP FUNCTION IF EXISTS public.get_current_age_policy();
DROP TABLE IF EXISTS public.content_access_authorizations;
DELETE FROM public.site_settings WHERE key='adult_content_policy'
  AND EXISTS (SELECT 1 FROM public.content_access_install_state WHERE singleton=true AND seeded_policy=true);
DROP TABLE IF EXISTS public.content_access_install_state;

COMMIT;
