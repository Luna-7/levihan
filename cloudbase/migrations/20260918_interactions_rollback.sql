BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.moderation_actions WHERE action IN ('review','resolve'))
    OR EXISTS(SELECT 1 FROM public.reports GROUP BY reporter_id,target_type,target_id HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM public.interaction_install_state state WHERE (SELECT count(*) FROM public.reading_progress)<>state.migrated_progress_count OR EXISTS(SELECT 1 FROM public.reading_progress progress WHERE progress.updated_at>=state.installed_at))
    OR EXISTS(SELECT 1 FROM public.interaction_install_state state WHERE state.seeded_work_id IS NOT NULL AND (EXISTS(SELECT 1 FROM public.work_likes WHERE work_id=state.seeded_work_id) OR EXISTS(SELECT 1 FROM public.favorites WHERE work_id=state.seeded_work_id) OR EXISTS(SELECT 1 FROM public.comments WHERE work_id=state.seeded_work_id) OR EXISTS(SELECT 1 FROM public.reading_progress WHERE work_id=state.seeded_work_id) OR EXISTS(SELECT 1 FROM public.reports WHERE target_type='work' AND target_id=state.seeded_work_id) OR EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=state.seeded_work_id) OR EXISTS(SELECT 1 FROM public.work_chapters WHERE work_id=state.seeded_work_id)))
  THEN RAISE EXCEPTION 'rollback_requires_interaction_export'; END IF;
END $$;
DROP FUNCTION IF EXISTS public.moderate_interaction_report_v2(uuid,uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.create_interaction_report_v2(uuid,uuid,text,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.interaction_assert_report_target(uuid,uuid,text,uuid);
DROP FUNCTION IF EXISTS public.sync_reading_progress_v2(uuid,uuid,text,jsonb,numeric,integer,bigint,bigint,uuid);
DROP FUNCTION IF EXISTS public.get_reading_progress_v2(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.moderate_work_comment_v2(uuid,uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.delete_work_comment_v2(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.create_work_comment_v2(uuid,uuid,text,text,uuid,text);
DROP FUNCTION IF EXISTS public.list_work_comments_v2(uuid,uuid,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.set_work_reaction_v2(uuid,uuid,text,text,boolean);
DROP FUNCTION IF EXISTS public.interaction_assert_work(uuid,uuid,text,boolean);
DROP FUNCTION IF EXISTS public.interaction_assert_admin(uuid,uuid);
DROP FUNCTION IF EXISTS public.interaction_assert_actor(uuid,uuid);
ALTER TABLE public.reading_progress DROP CONSTRAINT IF EXISTS reading_progress_position_v2_check;
DROP FUNCTION IF EXISTS public.interaction_valid_position(jsonb);
DROP INDEX IF EXISTS public.reports_active_target_uidx;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reason_v2_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_id_target_type_target_id_key UNIQUE(reporter_id,target_type,target_id);
ALTER TABLE public.reports DROP COLUMN IF EXISTS note;
ALTER TABLE public.reading_progress DROP COLUMN IF EXISTS client_mutation_id,DROP COLUMN IF EXISTS logic_version,DROP COLUMN IF EXISTS position_data;
ALTER TABLE public.moderation_actions DROP CONSTRAINT moderation_actions_action_check;
ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_action_check CHECK (action IN ('approve','hide','reject','request_changes','withdraw','restore','suspend'));
DELETE FROM public.site_settings WHERE key='interaction_comment_policy' AND EXISTS(SELECT 1 FROM public.interaction_install_state WHERE singleton=true AND seeded_policy=true);
DELETE FROM public.works WHERE id=(SELECT seeded_work_id FROM public.interaction_install_state WHERE singleton=true);
DROP TABLE IF EXISTS public.interaction_install_state;
COMMIT;
