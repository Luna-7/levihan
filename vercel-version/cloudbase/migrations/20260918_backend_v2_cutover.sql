BEGIN;

ALTER TABLE public.app_users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE public.app_users ADD COLUMN credential_state text NOT NULL DEFAULT 'active';
ALTER TABLE public.app_users ADD CONSTRAINT app_users_credential_state_check CHECK (credential_state IN ('active','migration_required'));
ALTER TABLE public.app_users ADD CONSTRAINT app_users_credential_password_check CHECK (
  (credential_state='migration_required' AND password_hash IS NULL) OR
  (credential_state='active' AND password_hash ~ '^\$argon2id\$')
);

CREATE TABLE public.legacy_identity_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK (source_system IN ('cloudbase','legacy_json')),
  legacy_id_hash text NOT NULL CHECK (legacy_id_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_system,legacy_id_hash), UNIQUE(user_id)
);

CREATE TABLE public.legacy_migration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','used','revoked','expired')),
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  claim_session_hash text UNIQUE CHECK (claim_session_hash IS NULL OR claim_session_hash ~ '^[a-f0-9]{64}$'),
  claim_expires_at timestamptz,
  prepared_recovery_hash text CHECK(prepared_recovery_hash IS NULL OR prepared_recovery_hash ~ '^[a-f0-9]{64}$'),
  prepare_nonce_hash text UNIQUE CHECK(prepare_nonce_hash IS NULL OR prepare_nonce_hash ~ '^[a-f0-9]{64}$'),
  prepare_expires_at timestamptz,
  delivery_ciphertext text NOT NULL CHECK(length(delivery_ciphertext) BETWEEN 32 AND 16384),
  issued_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '14 days'),
  CHECK ((status = 'used') = (used_at IS NOT NULL))
);
CREATE UNIQUE INDEX legacy_migration_credentials_pending_user_key ON public.legacy_migration_credentials(user_id) WHERE status='pending';
CREATE INDEX legacy_migration_credentials_expiry_idx ON public.legacy_migration_credentials(expires_at) WHERE status='pending';

CREATE TABLE public.backend_v2_migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK(environment IN ('nonprod','prod')),
  backup_id text NOT NULL CHECK(length(backup_id) BETWEEN 8 AND 128),
  status text NOT NULL CHECK(status IN ('running','failed','completed')),
  checkpoint text,
  aggregate_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
  plan_digest text NOT NULL CHECK(plan_digest ~ '^[a-f0-9]{64}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX backend_v2_migration_one_running ON public.backend_v2_migration_runs((true)) WHERE status='running';
CREATE UNIQUE INDEX backend_v2_migration_plan_key ON public.backend_v2_migration_runs(environment,backup_id,source_digest,plan_digest);
ALTER TABLE public.legacy_migration_credentials ADD COLUMN migration_run_id uuid NOT NULL REFERENCES public.backend_v2_migration_runs(id) ON DELETE RESTRICT;

CREATE TABLE public.backend_v2_migration_lock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), holder_id uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.backend_v2_migration_context (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  environment text NOT NULL CHECK(environment IN ('nonprod','prod')),
  allowed_role name NOT NULL,
  configured_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.assert_backend_v2_migration_context(p_environment text,p_expected_role text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context public.backend_v2_migration_context%ROWTYPE; caller pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO context FROM public.backend_v2_migration_context WHERE singleton;
  SELECT * INTO caller FROM pg_catalog.pg_roles WHERE rolname=session_user::text;
  IF context.singleton IS DISTINCT FROM true OR caller.rolname IS NULL OR context.environment<>p_environment OR context.allowed_role::text<>p_expected_role OR session_user::text<>context.allowed_role::text
  THEN RAISE EXCEPTION 'migration_identity_or_environment_mismatch' USING ERRCODE='42501'; END IF;
  IF caller.rolsuper OR caller.rolbypassrls OR caller.rolcreaterole OR caller.rolcreatedb OR caller.rolinherit
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.member=caller.oid)
    OR EXISTS(
      SELECT 1 FROM pg_catalog.pg_class object
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=object.relnamespace
      WHERE namespace.nspname='public' AND object.relkind IN ('r','p','S')
        AND (object.relowner=caller.oid OR (object.relkind IN ('r','p') AND has_table_privilege(session_user,format('%I.%I',namespace.nspname,object.relname),'INSERT,UPDATE,DELETE,TRUNCATE')) OR (object.relkind='S' AND has_sequence_privilege(session_user,format('%I.%I',namespace.nspname,object.relname),'USAGE,UPDATE')))
    )
    OR EXISTS(
      SELECT 1 FROM pg_catalog.pg_proc routine
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
      WHERE namespace.nspname='public' AND routine.proowner=caller.oid
    )
  THEN RAISE EXCEPTION 'migration_role_is_overprivileged' USING ERRCODE='42501'; END IF;
  RETURN true;
END; $$;

CREATE TABLE public.legacy_entity_mappings (
  source_system text NOT NULL CHECK(source_system IN ('cloudbase','legacy_json')),
  entity_type text NOT NULL CHECK(entity_type IN ('work','chapter','asset','comment')),
  legacy_id_hash text NOT NULL CHECK(legacy_id_hash ~ '^[a-f0-9]{64}$'),
  target_id uuid NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_system,entity_type,legacy_id_hash), UNIQUE(entity_type,target_id)
);

CREATE TABLE public.migration_public_asset_deletions (
  manifest_digest text NOT NULL CHECK(manifest_digest ~ '^[a-f0-9]{64}$'),
  source_key_hash text NOT NULL CHECK(source_key_hash ~ '^[a-f0-9]{64}$'),
  private_key_hash text NOT NULL CHECK(private_key_hash ~ '^[a-f0-9]{64}$'),
  backup_id text NOT NULL, checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK(status IN ('claimed','completed')), fencing_token bigint NOT NULL DEFAULT 1 CHECK(fencing_token>0),
  claimed_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  PRIMARY KEY(manifest_digest,source_key_hash),
  CHECK((status='completed')=(completed_at IS NOT NULL))
);

CREATE TABLE public.legacy_forum_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id_hash text NOT NULL UNIQUE CHECK(legacy_id_hash ~ '^[a-f0-9]{64}$'),
  parent_legacy_id_hash text CHECK(parent_legacy_id_hash IS NULL OR parent_legacy_id_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  author_label text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '', body text NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','deleted')),
  created_at timestamptz NOT NULL
);

CREATE TABLE public.legacy_game_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id_hash text NOT NULL UNIQUE CHECK(legacy_id_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  legacy_user_id_hash text CHECK(legacy_user_id_hash IS NULL OR legacy_user_id_hash ~ '^[a-f0-9]{64}$'),
  game_key text NOT NULL CHECK(game_key IN ('daxigua','hange')),
  score integer NOT NULL CHECK(score BETWEEN 0 AND 1000), raw_score jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE FUNCTION public.claim_backend_v2_migration_lock(p_holder_id uuid, p_lease_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE claimed boolean;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN RAISE EXCEPTION 'migration_lock_invalid' USING ERRCODE='23514'; END IF;
  INSERT INTO public.backend_v2_migration_lock(singleton,holder_id,lease_expires_at)
  VALUES(true,p_holder_id,clock_timestamp()+make_interval(secs=>p_lease_seconds))
  ON CONFLICT(singleton) DO UPDATE SET holder_id=excluded.holder_id,lease_expires_at=excluded.lease_expires_at,updated_at=clock_timestamp()
    WHERE public.backend_v2_migration_lock.lease_expires_at <= clock_timestamp() OR public.backend_v2_migration_lock.holder_id=p_holder_id
  RETURNING true INTO claimed;
  RETURN coalesce(claimed,false);
END; $$;

CREATE FUNCTION public.release_backend_v2_migration_lock(p_holder_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  DELETE FROM public.backend_v2_migration_lock WHERE singleton AND holder_id=p_holder_id RETURNING true
$$;

CREATE FUNCTION public.begin_backend_v2_migration_run(p_environment text,p_backup_id text,p_source_digest text,p_plan_digest text,p_counts jsonb)
RETURNS TABLE(run_id uuid,checkpoint text,source_digest text,plan_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.backend_v2_migration_runs%ROWTYPE;
BEGIN
  IF p_environment NOT IN ('nonprod','prod') OR p_source_digest !~ '^[a-f0-9]{64}$' OR p_plan_digest !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_counts)<>'object' THEN RAISE EXCEPTION 'migration_run_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO existing FROM public.backend_v2_migration_runs
    WHERE environment=p_environment AND backup_id=p_backup_id ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND (existing.source_digest<>p_source_digest OR existing.plan_digest<>p_plan_digest) THEN
    RAISE EXCEPTION 'migration_plan_changed' USING ERRCODE='23514';
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.backend_v2_migration_runs(environment,backup_id,status,aggregate_counts,source_digest,plan_digest)
      VALUES(p_environment,p_backup_id,'running',p_counts,p_source_digest,p_plan_digest) RETURNING * INTO existing;
  END IF;
  RETURN QUERY SELECT existing.id,existing.checkpoint,existing.source_digest,existing.plan_digest;
END; $$;

CREATE FUNCTION public.validate_migrated_work_publication(p_work_id uuid,p_expected_asset_hash text,p_restricted boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE work public.works%ROWTYPE; actual_hash text;
BEGIN
  SELECT * INTO work FROM public.works WHERE id=p_work_id FOR UPDATE;
  IF NOT FOUND OR work.status<>'draft' OR (work.rating='restricted')<>p_restricted OR p_expected_asset_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  PERFORM 1 FROM public.work_chapters WHERE work_id=p_work_id FOR UPDATE;
  PERFORM 1 FROM public.work_assets WHERE work_id=p_work_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.work_assets a JOIN public.work_chapters c ON c.id=a.chapter_id WHERE a.work_id=p_work_id AND c.work_id<>p_work_id) THEN RETURN false; END IF;
  SELECT encode(public.digest(coalesce(string_agg(concat_ws(E'\t',a.object_key,a.checksum,a.kind,a.mime_type,a.size_bytes::text,coalesce(a.page_no::text,''),coalesce(c.position::text,'')),E'\n' ORDER BY a.object_key),''),'sha256'),'hex') INTO actual_hash
    FROM public.work_assets a LEFT JOIN public.work_chapters c ON c.id=a.chapter_id AND c.work_id=a.work_id WHERE a.work_id=p_work_id AND a.status='active';
  IF actual_hash<>p_expected_asset_hash OR NOT EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND status='active') THEN RETURN false; END IF;
  IF p_restricted AND EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND (status<>'active' OR storage_zone<>'private' OR access_level<>'private' OR object_key NOT LIKE 'protected/works/%')) THEN RETURN false; END IF;
  IF NOT p_restricted AND EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND status='active' AND (storage_zone<>'public' OR access_level<>'public' OR object_key NOT LIKE 'media/works/%')) THEN RETURN false; END IF;
  IF work.type='comic' AND (NOT EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND kind='cover' AND status='active') OR NOT EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND kind='page' AND status='active') OR EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND kind NOT IN ('cover','page','preview','attachment'))) THEN RETURN false; END IF;
  IF work.type='comic' AND EXISTS(SELECT 1 FROM public.work_chapters c WHERE c.work_id=p_work_id AND NOT EXISTS(SELECT 1 FROM public.work_assets a WHERE a.chapter_id=c.id AND a.work_id=p_work_id AND a.kind='page' AND a.status='active')) THEN RETURN false; END IF;
  IF work.type='comic' AND EXISTS(SELECT 1 FROM public.work_assets a WHERE a.work_id=p_work_id AND a.kind='page' AND a.status='active' GROUP BY a.chapter_id HAVING min(a.page_no)<>1 OR max(a.page_no)<>count(*) OR count(DISTINCT a.page_no)<>count(*)) THEN RETURN false; END IF;
  IF work.type='novel' AND (NOT EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND kind='cover' AND status='active') OR EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND kind NOT IN ('cover','body','preview','attachment'))) THEN RETURN false; END IF;
  IF work.type='novel' AND NOT EXISTS(SELECT 1 FROM public.work_chapters WHERE work_id=p_work_id) AND (SELECT count(*) FROM public.work_assets WHERE work_id=p_work_id AND chapter_id IS NULL AND kind='body' AND status='active')<>1 THEN RETURN false; END IF;
  IF work.type='novel' AND EXISTS(SELECT 1 FROM public.work_chapters WHERE work_id=p_work_id) AND (EXISTS(SELECT 1 FROM public.work_assets WHERE work_id=p_work_id AND chapter_id IS NULL AND kind='body' AND status='active') OR EXISTS(SELECT 1 FROM public.work_chapters c LEFT JOIN public.work_assets a ON a.chapter_id=c.id AND a.work_id=p_work_id AND a.kind='body' AND a.status='active' WHERE c.work_id=p_work_id GROUP BY c.id HAVING count(a.id)<>1)) THEN RETURN false; END IF;
  RETURN true;
END; $$;

CREATE FUNCTION public.apply_backend_v2_migration_batch(
  p_run_id uuid,p_source_digest text,p_plan_digest text,p_checkpoint text,p_kind text,p_items jsonb
) RETURNS TABLE(checkpoint text,credentials_issued integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run public.backend_v2_migration_runs%ROWTYPE; item jsonb; mapped_id uuid; v_work_id uuid; v_chapter_id uuid; v_user_id uuid; issued integer:=0;
BEGIN
  SELECT * INTO run FROM public.backend_v2_migration_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR run.status<>'running' OR run.source_digest<>p_source_digest OR run.plan_digest<>p_plan_digest
    OR jsonb_typeof(p_items)<>'array' OR p_checkpoint !~ '^[A-Za-z]+(?:Finalize)?:[0-9]+$'
    THEN RAISE EXCEPTION 'migration_batch_invalid' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_work_id:=NULL; v_chapter_id:=NULL; v_user_id:=NULL; mapped_id:=NULL;
    IF p_kind='users' THEN
      INSERT INTO public.app_users(username,password_hash,role,status,credential_state)
        VALUES(item->>'username',NULL,item->>'role',item->>'status','migration_required') RETURNING id INTO mapped_id;
      INSERT INTO public.legacy_identity_mappings(source_system,legacy_id_hash,user_id) VALUES('cloudbase',item->>'legacyIdHash',mapped_id);
      INSERT INTO public.legacy_migration_credentials(migration_run_id,user_id,token_hash,expires_at,delivery_ciphertext)
        VALUES(run.id,mapped_id,item->>'credentialHash',(item->>'credentialExpiresAt')::timestamptz,item->>'deliveryCiphertext');
      issued:=issued+1;
    ELSIF p_kind='works' THEN
      INSERT INTO public.works(slug,type,title,summary,rating,status,author_name,published_at)
        VALUES(item->>'slug',item->>'type',item->>'title',coalesce(item->>'summary',''),item->>'rating','draft',item->>'authorName',NULL) RETURNING id INTO mapped_id;
      INSERT INTO public.legacy_entity_mappings(source_system,entity_type,legacy_id_hash,target_id) VALUES('legacy_json','work',item->>'legacyIdHash',mapped_id);
    ELSIF p_kind='chapters' THEN
      SELECT target_id INTO v_work_id FROM public.legacy_entity_mappings WHERE source_system='legacy_json' AND entity_type='work' AND legacy_id_hash=item->>'workLegacyIdHash';
      IF v_work_id IS NULL THEN RAISE EXCEPTION 'migration_orphan_chapter' USING ERRCODE='23503'; END IF;
      INSERT INTO public.work_chapters(work_id,title,position,status) VALUES(v_work_id,item->>'title',(item->>'position')::integer,'draft') RETURNING id INTO mapped_id;
      INSERT INTO public.legacy_entity_mappings(source_system,entity_type,legacy_id_hash,target_id) VALUES('legacy_json','chapter',item->>'legacyIdHash',mapped_id);
    ELSIF p_kind='assets' THEN
      SELECT target_id INTO v_work_id FROM public.legacy_entity_mappings WHERE source_system='legacy_json' AND entity_type='work' AND legacy_id_hash=item->>'workLegacyIdHash';
      IF v_work_id IS NULL THEN RAISE EXCEPTION 'migration_orphan_asset' USING ERRCODE='23503'; END IF;
      IF item ? 'chapterLegacyIdHash' THEN SELECT m.target_id INTO v_chapter_id FROM public.legacy_entity_mappings m JOIN public.work_chapters c ON c.id=m.target_id WHERE m.entity_type='chapter' AND m.legacy_id_hash=item->>'chapterLegacyIdHash' AND c.work_id=v_work_id; END IF;
      IF item ? 'chapterLegacyIdHash' AND v_chapter_id IS NULL THEN RAISE EXCEPTION 'migration_orphan_asset_chapter' USING ERRCODE='23503'; END IF;
      INSERT INTO public.work_assets(work_id,chapter_id,kind,object_key,storage_zone,access_level,mime_type,size_bytes,checksum,page_no,status)
        VALUES(v_work_id,v_chapter_id,item->>'kind',item->>'objectKey',item->>'storageZone',item->>'accessLevel',item->>'mimeType',(item->>'sizeBytes')::bigint,item->>'checksum',nullif(item->>'pageNo','')::integer,item->>'status') RETURNING id INTO mapped_id;
      INSERT INTO public.legacy_entity_mappings(source_system,entity_type,legacy_id_hash,target_id) VALUES('legacy_json','asset',item->>'legacyIdHash',mapped_id);
    ELSIF p_kind='comments' THEN
      SELECT target_id INTO v_work_id FROM public.legacy_entity_mappings WHERE entity_type='work' AND legacy_id_hash=item->>'workLegacyIdHash';
      SELECT m.user_id INTO v_user_id FROM public.legacy_identity_mappings m WHERE m.legacy_id_hash=item->>'userLegacyIdHash';
      IF v_work_id IS NULL OR v_user_id IS NULL THEN RAISE EXCEPTION 'migration_orphan_comment' USING ERRCODE='23503'; END IF;
      INSERT INTO public.comments(work_id,user_id,body,status,created_at) VALUES(v_work_id,v_user_id,item->>'body',item->>'status',(item->>'createdAt')::timestamptz) RETURNING id INTO mapped_id;
      INSERT INTO public.legacy_entity_mappings(source_system,entity_type,legacy_id_hash,target_id) VALUES('cloudbase','comment',item->>'legacyIdHash',mapped_id);
    ELSIF p_kind='forumPosts' THEN
      INSERT INTO public.legacy_forum_entries(legacy_id_hash,parent_legacy_id_hash,author_label,title,body,status,created_at)
        VALUES(item->>'legacyIdHash',item->>'parentLegacyIdHash',coalesce(item->>'authorLabel',''),coalesce(item->>'title',''),item->>'body',item->>'status',(item->>'createdAt')::timestamptz);
    ELSIF p_kind='leaderboardEntries' THEN
      INSERT INTO public.legacy_game_entries(legacy_id_hash,legacy_user_id_hash,game_key,score,raw_score,created_at)
        VALUES(item->>'legacyIdHash',item->>'userLegacyIdHash',item->>'gameKey',(item->>'score')::integer,coalesce(item->'rawScore','{}'::jsonb),(item->>'createdAt')::timestamptz);
    ELSIF p_kind IN ('restrictedFinalize','publicFinalize') THEN
      SELECT target_id INTO v_work_id FROM public.legacy_entity_mappings WHERE entity_type='work' AND legacy_id_hash=item->>'legacyIdHash';
      IF v_work_id IS NULL OR NOT public.validate_migrated_work_publication(v_work_id,item->>'assetSetHash',p_kind='restrictedFinalize') THEN RAISE EXCEPTION 'migration_publication_invalid' USING ERRCODE='23514'; END IF;
      UPDATE public.works SET status='published',published_at=coalesce(nullif(item->>'publishedAt','')::timestamptz,clock_timestamp()),version=version+1,updated_at=clock_timestamp() WHERE id=v_work_id AND status='draft';
      UPDATE public.work_chapters SET status='published',updated_at=clock_timestamp() WHERE work_id=v_work_id;
    ELSE RAISE EXCEPTION 'migration_kind_invalid' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF p_kind='migrationComplete' THEN
    UPDATE public.backend_v2_migration_runs SET checkpoint=p_checkpoint,status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=run.id;
  ELSE
    UPDATE public.backend_v2_migration_runs SET checkpoint=p_checkpoint,updated_at=clock_timestamp() WHERE id=run.id;
  END IF;
  RETURN QUERY SELECT p_checkpoint,issued;
END; $$;

CREATE FUNCTION public.collect_backend_v2_check(p_run_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,'sourceSnapshotId',r.source_digest,'migrationRunId',r.id,'targetSchemaVersion','20260918_backend_v2_cutover',
    'source',r.aggregate_counts,
    'target',jsonb_build_object('users',(SELECT count(*) FROM public.legacy_identity_mappings),'works',(SELECT count(*) FROM public.legacy_entity_mappings WHERE entity_type='work'),'chapters',(SELECT count(*) FROM public.legacy_entity_mappings WHERE entity_type='chapter'),'assets',(SELECT count(*) FROM public.legacy_entity_mappings WHERE entity_type='asset'),'comments',(SELECT count(*) FROM public.legacy_entity_mappings WHERE entity_type='comment'),'forumPosts',(SELECT count(*) FROM public.legacy_forum_entries),'leaderboardEntries',(SELECT count(*) FROM public.legacy_game_entries)),
    'invariants',jsonb_build_object(
      'orphanForeignKeys',(
        SELECT count(*) FROM public.legacy_entity_mappings m WHERE
          (m.entity_type='work' AND NOT EXISTS(SELECT 1 FROM public.works w WHERE w.id=m.target_id)) OR
          (m.entity_type='chapter' AND NOT EXISTS(SELECT 1 FROM public.work_chapters c WHERE c.id=m.target_id)) OR
          (m.entity_type='asset' AND NOT EXISTS(SELECT 1 FROM public.work_assets a WHERE a.id=m.target_id)) OR
          (m.entity_type='comment' AND NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=m.target_id))
      ),
      'duplicateKeys',(
        SELECT count(*) FROM (
          SELECT slug FROM public.works GROUP BY slug HAVING count(*)>1
          UNION ALL SELECT object_key FROM public.work_assets GROUP BY object_key HAVING count(*)>1
        ) duplicates
      ),
      'uuidShapedSlugs',(SELECT count(*) FROM public.works WHERE slug ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
      'invalidStates',(
        (SELECT count(*) FROM public.app_users WHERE credential_state='migration_required' AND password_hash IS NOT NULL) +
        (SELECT count(*) FROM public.legacy_migration_credentials WHERE status='pending' AND (expires_at<=clock_timestamp() OR expires_at>issued_at+interval '14 days'))
      ),
      'invalidAssets',(SELECT count(*) FROM public.work_assets a JOIN public.works w ON w.id=a.work_id WHERE w.rating='restricted' AND a.status='active' AND (a.access_level<>'private' OR a.object_key NOT LIKE 'protected/works/%')),
      'snapshotDrift',(
        (SELECT count(*) FROM public.snapshot_jobs WHERE status NOT IN ('succeeded','cancelled')) +
        (SELECT count(*) FROM (SELECT snapshot_type,max(version) AS version FROM public.snapshot_versions GROUP BY snapshot_type) latest LEFT JOIN public.snapshot_current current ON current.snapshot_type=latest.snapshot_type WHERE current.version IS NULL OR current.version<>latest.version)
      ),
      'publicRestrictedObjects',(SELECT count(*) FROM public.work_assets a JOIN public.works w ON w.id=a.work_id WHERE w.rating='restricted' AND (a.access_level='public' OR a.object_key NOT LIKE 'protected/works/%')),
      'recoveryStateMissing',(SELECT count(*) FROM public.app_users u WHERE u.credential_state='migration_required' AND NOT EXISTS(SELECT 1 FROM public.legacy_migration_credentials c WHERE c.user_id=u.id AND c.status='pending' AND c.expires_at>clock_timestamp() AND c.expires_at<=c.issued_at+interval '14 days'))
    )
  ) FROM public.backend_v2_migration_runs r WHERE r.id=p_run_id
$$;

CREATE FUNCTION public.collect_backend_v2_snapshot_manifest()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('snapshotType',snapshot_type,'version',version,'objectKey',object_key,'checksum',checksum) ORDER BY snapshot_type),'[]'::jsonb) FROM public.snapshot_current
$$;

CREATE FUNCTION public.export_backend_v2_credential_envelopes(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.backend_v2_migration_runs WHERE id=p_run_id AND status='completed') THEN RAISE EXCEPTION 'migration_run_not_completed' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('ciphertext',delivery_ciphertext) ORDER BY id),'[]'::jsonb) INTO result FROM public.legacy_migration_credentials WHERE migration_run_id=p_run_id;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id) VALUES(NULL,'migration.credentials_exported','migration_run',p_run_id,jsonb_build_object('count',jsonb_array_length(result)),'migration-envelope-export:'||p_run_id::text||':'||extract(epoch from clock_timestamp())::bigint::text);
  RETURN result;
END; $$;

CREATE FUNCTION public.claim_public_asset_deletion(p_holder_id uuid,p_manifest_digest text,p_source_key_hash text,p_private_key text,p_private_key_hash text,p_backup_id text,p_checksum text)
RETURNS TABLE(state text,fencing_token bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row public.migration_public_asset_deletions%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.backend_v2_migration_lock WHERE singleton AND holder_id=p_holder_id AND lease_expires_at>clock_timestamp())
    THEN RAISE EXCEPTION 'cutover_lock_lost' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.work_assets a JOIN public.works w ON w.id=a.work_id
    WHERE a.object_key=p_private_key AND a.checksum=p_checksum AND a.status='active' AND a.access_level='private' AND w.rating='restricted')
    THEN RAISE EXCEPTION 'cutover_asset_not_bound' USING ERRCODE='23514'; END IF;
  INSERT INTO public.migration_public_asset_deletions(manifest_digest,source_key_hash,private_key_hash,backup_id,checksum,status)
    VALUES(p_manifest_digest,p_source_key_hash,p_private_key_hash,p_backup_id,p_checksum,'claimed')
    ON CONFLICT(manifest_digest,source_key_hash) DO UPDATE SET fencing_token=public.migration_public_asset_deletions.fencing_token+1,claimed_at=clock_timestamp()
      WHERE public.migration_public_asset_deletions.status='claimed'
    RETURNING * INTO row;
  IF NOT FOUND THEN SELECT * INTO row FROM public.migration_public_asset_deletions WHERE manifest_digest=p_manifest_digest AND source_key_hash=p_source_key_hash; END IF;
  IF row.private_key_hash<>p_private_key_hash OR row.backup_id<>p_backup_id OR row.checksum<>p_checksum THEN RAISE EXCEPTION 'cutover_claim_conflict' USING ERRCODE='23514'; END IF;
  RETURN QUERY SELECT row.status,row.fencing_token;
END; $$;

CREATE FUNCTION public.finalize_public_asset_deletion(p_holder_id uuid,p_manifest_digest text,p_source_key_hash text,p_fencing_token bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.backend_v2_migration_lock WHERE singleton AND holder_id=p_holder_id AND lease_expires_at>clock_timestamp())
    THEN RAISE EXCEPTION 'cutover_lock_lost' USING ERRCODE='40001'; END IF;
  UPDATE public.migration_public_asset_deletions SET status='completed',completed_at=clock_timestamp()
    WHERE manifest_digest=p_manifest_digest AND source_key_hash=p_source_key_hash AND status='claimed' AND fencing_token=p_fencing_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'cutover_fence_lost' USING ERRCODE='40001'; END IF;
  RETURN true;
END; $$;

CREATE FUNCTION public.begin_legacy_migration_claim(p_credential_hash text, p_claim_session_hash text, p_ip_hash text)
RETURNS TABLE(expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE credential public.legacy_migration_credentials%ROWTYPE; claim_expiry timestamptz := clock_timestamp()+interval '10 minutes';
BEGIN
  SELECT * INTO credential FROM public.legacy_migration_credentials WHERE token_hash=p_credential_hash FOR UPDATE;
  IF NOT FOUND OR credential.status <> 'pending' OR credential.expires_at <= clock_timestamp() OR credential.attempt_count >= 10
  THEN RAISE EXCEPTION 'migration_credential_invalid' USING ERRCODE='23514'; END IF;
  UPDATE public.legacy_migration_credentials SET claim_session_hash=p_claim_session_hash,claim_expires_at=claim_expiry,attempt_count=attempt_count+1 WHERE id=credential.id;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
    VALUES(credential.user_id,'legacy_credential.claimed','user',credential.user_id,jsonb_build_object('expiresAt',claim_expiry,'ipHash',p_ip_hash),'legacy-claim:'||credential.id::text);
  RETURN QUERY SELECT claim_expiry;
END;
$$;

CREATE FUNCTION public.prepare_legacy_migration_credential(p_claim_session_hash text,p_recovery_code_hash text,p_prepare_nonce_hash text)
RETURNS TABLE(expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE credential public.legacy_migration_credentials%ROWTYPE; prepared_until timestamptz:=clock_timestamp()+interval '10 minutes';
BEGIN
  SELECT * INTO credential FROM public.legacy_migration_credentials WHERE claim_session_hash=p_claim_session_hash FOR UPDATE;
  IF NOT FOUND OR credential.status<>'pending' OR credential.expires_at<=clock_timestamp() OR credential.claim_expires_at<=clock_timestamp()
    OR p_recovery_code_hash !~ '^[a-f0-9]{64}$' OR p_prepare_nonce_hash !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'migration_credential_invalid' USING ERRCODE='23514'; END IF;
  UPDATE public.legacy_migration_credentials SET prepared_recovery_hash=p_recovery_code_hash,prepare_nonce_hash=p_prepare_nonce_hash,prepare_expires_at=prepared_until WHERE id=credential.id;
  RETURN QUERY SELECT prepared_until;
END; $$;

CREATE FUNCTION public.consume_legacy_migration_credential(
  p_claim_session_hash text, p_prepare_nonce_hash text, p_new_password_hash text, p_recovery_code_hash text,
  p_session_token_hash text, p_ip_hash text
)
RETURNS TABLE(user_id uuid, session_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE credential public.legacy_migration_credentials%ROWTYPE; app_user public.app_users%ROWTYPE; created_session uuid; session_expiry timestamptz;
BEGIN
  SELECT * INTO credential FROM public.legacy_migration_credentials
   WHERE claim_session_hash=p_claim_session_hash FOR UPDATE;
  IF NOT FOUND OR credential.status <> 'pending' OR credential.expires_at <= clock_timestamp() OR credential.claim_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'migration_credential_invalid' USING ERRCODE='23514';
  END IF;
  IF credential.prepare_expires_at<=clock_timestamp() OR credential.prepare_nonce_hash<>p_prepare_nonce_hash OR credential.prepared_recovery_hash<>p_recovery_code_hash
    THEN RAISE EXCEPTION 'migration_credential_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO app_user FROM public.app_users WHERE id=credential.user_id FOR UPDATE;
  IF NOT FOUND OR app_user.status <> 'active' OR app_user.credential_state <> 'migration_required' THEN
    RAISE EXCEPTION 'migration_credential_invalid' USING ERRCODE='23514';
  END IF;
  IF p_new_password_hash !~ '^\$argon2id\$' THEN
    RAISE EXCEPTION 'migration_credential_invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.app_users SET password_hash=p_new_password_hash, credential_state='active', recovery_confirmed_at=NULL, updated_at=clock_timestamp()
   WHERE id=app_user.id;
  session_expiry:=clock_timestamp()+CASE WHEN app_user.role='admin' THEN interval '8 hours' ELSE interval '30 days' END;
  UPDATE public.legacy_migration_credentials SET status=CASE WHEN id=credential.id THEN 'used' ELSE 'revoked' END,
    used_at=CASE WHEN id=credential.id THEN clock_timestamp() ELSE NULL END
   WHERE user_id=app_user.id AND status='pending';
  INSERT INTO public.recovery_codes(user_id,code_hash) VALUES(app_user.id,p_recovery_code_hash);
  INSERT INTO public.user_sessions(user_id,token_hash,expires_at,recovery_confirmed_at,ip_hash)
   VALUES(app_user.id,p_session_token_hash,session_expiry,NULL,p_ip_hash) RETURNING id INTO created_session;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
   VALUES(app_user.id,'legacy_credential.consumed','user',app_user.id,jsonb_build_object('recoveryConfirmationRequired',true),'legacy-credential:'||credential.id::text);
  RETURN QUERY SELECT app_user.id, created_session, session_expiry;
END;
$$;

ALTER TABLE public.legacy_identity_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_migration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backend_v2_migration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backend_v2_migration_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backend_v2_migration_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_entity_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_public_asset_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_forum_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_game_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legacy_identity_mappings, public.legacy_migration_credentials, public.backend_v2_migration_runs, public.backend_v2_migration_lock, public.legacy_entity_mappings, public.migration_public_asset_deletions, public.legacy_forum_entries, public.legacy_game_entries FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_backend_v2_migration_context(text,text), public.claim_backend_v2_migration_lock(uuid,integer), public.release_backend_v2_migration_lock(uuid), public.begin_backend_v2_migration_run(text,text,text,text,jsonb), public.validate_migrated_work_publication(uuid,text,boolean), public.apply_backend_v2_migration_batch(uuid,text,text,text,text,jsonb), public.collect_backend_v2_check(uuid), public.collect_backend_v2_snapshot_manifest(), public.export_backend_v2_credential_envelopes(uuid), public.claim_public_asset_deletion(uuid,text,text,text,text,text,text), public.finalize_public_asset_deletion(uuid,text,text,bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_legacy_migration_claim(text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prepare_legacy_migration_credential(text,text,text), public.consume_legacy_migration_credential(text,text,text,text,text,text) FROM PUBLIC;

COMMIT;
