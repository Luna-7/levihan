import { createHash, createHmac, publicEncrypt, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';

const requireFromApi = createRequire(new URL('../../cloudbase/functions/app-api/package.json', import.meta.url));
const REQUIRED_ENV = ['CLOUDBASE_ENV_ID','CLOUDBASE_APIKEY','DATABASE_SCHEMA','MIGRATION_EXPECTED_DB_ROLE','COS_PUBLIC_BUCKET','COS_PRIVATE_BUCKET','COS_REGION','COS_SECRET_ID','COS_SECRET_KEY','MIGRATION_HASH_PEPPER','MIGRATION_CREDENTIAL_PUBLIC_KEY','MIGRATION_TARGET_ENVIRONMENT'];

function requireEnv(env) {
  for (const key of REQUIRED_ENV) if (typeof env[key] !== 'string' || env[key].length < (key.endsWith('PEPPER') ? 32 : 1)) throw new Error(`Migration adapter configuration missing: ${key}`);
  if (env.MIGRATION_RUN_ID && !/^[0-9a-f-]{36}$/i.test(env.MIGRATION_RUN_ID)) throw new Error('Migration adapter configuration invalid: MIGRATION_RUN_ID');
}
function hash(pepper, domain, value) { return createHmac('sha256', pepper).update(`${domain}\0${String(value)}`).digest('hex'); }
function unwrap(result) {
  if (!result || result.error) throw new Error('Migration database RPC failed');
  return Array.isArray(result.data) ? result.data[0] : result.data;
}
function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]).finally(() => clearTimeout(timer));
}
function rpcAdapter(rdb, timeoutMs) { return async (name, params) => unwrap(await withTimeout(rdb.rpc(name, params), timeoutMs, 'Migration database RPC')); }
function cosCall(cos, method, params) { return new Promise((resolve, reject) => cos[method](params, (error, data) => error ? reject(error) : resolve(data))); }
function isMissingObject(error) { return ['NoSuchKey','NotFound','404'].includes(String(error?.code || error?.statusCode)); }
function magicValid(mime, bytes, unsafeText = false) {
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/gif') return ['GIF87a','GIF89a'].includes(bytes.subarray(0, 6).toString());
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'application/epub+zip') return bytes.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]));
  return mime.startsWith('text/') && !unsafeText;
}
async function pageCollection(db, name) {
  const values = []; let cursor = null;
  for (;;) {
    let query = db.collection(name).orderBy('_id', 'asc');
    if (cursor !== null) query = query.where({ _id: db.command.gt(cursor) });
    const result = await query.limit(100).get();
    const page = Array.isArray(result?.data) ? result.data : [];
    values.push(...page);
    if (page.length < 100) return values;
    cursor = page.at(-1)?._id;
    if (typeof cursor !== 'string' || !cursor) throw new Error('Legacy collection requires stable _id ordering');
  }
}

/** @param {{env?: NodeJS.ProcessEnv, cloudbase?: any, Cos?: any, expectedEnvironment?: string, readJson?: (path:string)=>Promise<any>}} dependencies */
export function createAdapterRuntime({ env = process.env, cloudbase, Cos, expectedEnvironment, readJson = async (path) => JSON.parse(await readFile(path, 'utf8')) } = {}) {
  requireEnv(env);
  if (!['nonprod','prod'].includes(env.MIGRATION_TARGET_ENVIRONMENT) || (expectedEnvironment && expectedEnvironment !== env.MIGRATION_TARGET_ENVIRONMENT)) throw new Error('Migration adapter target environment mismatch');
  const tcb = cloudbase || requireFromApi('@cloudbase/node-sdk');
  const CosCtor = Cos || requireFromApi('cos-nodejs-sdk-v5');
  const app = tcb.init({ env: env.CLOUDBASE_ENV_ID, accessKey: env.CLOUDBASE_APIKEY, timeout: Number(env.MIGRATION_DB_TIMEOUT_MS || 15000) });
  const db = app.database(); const rdb = app.rdb({ database: env.DATABASE_SCHEMA }); const rpc = rpcAdapter(rdb, Number(env.MIGRATION_DB_TIMEOUT_MS || 15000));
  const cos = new CosCtor({ SecretId: env.COS_SECRET_ID, SecretKey: env.COS_SECRET_KEY, Timeout: Number(env.MIGRATION_COS_TIMEOUT_MS || 30000) });
  const holderId = randomUUID();
  const keyHash = (domain, value) => hash(env.MIGRATION_HASH_PEPPER, domain, value);
  const sourceManifest = env.LEGACY_SOURCE_MANIFEST;
  let contextPromise;
  const ensureContext = () => contextPromise ||= rpc('assert_backend_v2_migration_context', { p_environment: env.MIGRATION_TARGET_ENVIRONMENT, p_expected_role: env.MIGRATION_EXPECTED_DB_ROLE }).then((value) => {
    if (value !== true) throw new Error('Migration database identity verification failed');
    return true;
  });

  async function readSource() {
    const file = sourceManifest ? await readJson(sourceManifest) : { works: [], assets: [] };
    const [rawUsers, rawComments, rawForum, rawScores] = await Promise.all([
      pageCollection(db, env.LEGACY_USERS_COLLECTION || 'users'), pageCollection(db, env.LEGACY_COMMENTS_COLLECTION || 'comments'),
      pageCollection(db, env.LEGACY_FORUM_COLLECTION || 'restaurantForum'), pageCollection(db, env.LEGACY_SCORES_COLLECTION || 'gameScores'),
    ]);
    const users = rawUsers.map((row) => {
      const legacyId = row.legacyId || row._openid || row.uid || row._id;
      const requested = String(row.username || '').trim().toLowerCase();
      return { legacyId, username: /^[a-z0-9_]{3,32}$/.test(requested) ? requested : `legacy_${keyHash('username', legacyId).slice(0, 12)}`, role: row.role === 'admin' ? 'admin' : 'member', status: ['active','suspended','deleted'].includes(row.status) ? row.status : 'active' };
    });
    const comments = rawComments.map((row) => ({ legacyId: row.legacyId || row._id, workLegacyId: row.workLegacyId || row.contentId, userLegacyId: row.userLegacyId || row.authorUid || row._openid, body: String(row.body || row.content || ''), status: ['pending','published','hidden','deleted','rejected'].includes(row.status) ? row.status : 'pending', createdAt: new Date(row.createdAt || 0).toISOString() }));
    const forumPosts = rawForum.map((row) => ({ legacyId: row.legacyId || row._id, parentLegacyId: row.parentId || null, authorLabel: String(row.author || ''), title: String(row.title || ''), body: String(row.body || ''), status: ['published','hidden','deleted'].includes(row.status) ? row.status : 'hidden', createdAt: new Date(row.createdAt || 0).toISOString() }));
    const leaderboardEntries = rawScores.map((row) => ({ legacyId: row.legacyId || row._id, userLegacyId: row.userLegacyId || row.uid || row._openid || null, gameKey: row.gameKey, score: Number(row.merit ?? row.score), rawScore: row.raw || {}, createdAt: new Date(row.achievedAt || row.createdAt || 0).toISOString() }));
    return { users, works: file.works || [], chapters: file.chapters || [], assets: file.assets || [], comments, forumPosts, leaderboardEntries };
  }
  const transformItem = (kind, item) => {
    const transformed = { ...item, legacyIdHash: keyHash(`${kind}:legacy-id`, item.legacyId) };
    delete transformed.legacyId;
    for (const relation of ['workLegacyId','chapterLegacyId','userLegacyId','parentLegacyId']) if (item[relation] != null) {
      const domain = relation === 'workLegacyId' ? 'works:legacy-id' : relation === 'userLegacyId' ? 'users:legacy-id' : 'forumPosts:legacy-id';
      const relationDomain = relation === 'chapterLegacyId' ? 'chapters:legacy-id' : domain;
      transformed[`${relation}Hash`] = keyHash(relationDomain, item[relation]); delete transformed[relation];
    }
    if (kind === 'users') {
      const proof = randomBytes(32).toString('base64url');
      transformed.credentialHash = keyHash('legacy-migration-credential', proof);
      transformed.credentialExpiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
      transformed.deliveryCiphertext = publicEncrypt(env.MIGRATION_CREDENTIAL_PUBLIC_KEY, Buffer.from(JSON.stringify({ legacyId: item.legacyId, migrationCredential: proof }))).toString('base64');
    }
    return transformed;
  };
  return {
    async readSource() { await ensureContext(); return readSource(); },
    async readTargetSummary() { return {}; },
    async acquireLock() { await ensureContext(); return Boolean(await rpc('claim_backend_v2_migration_lock', { p_holder_id: holderId, p_lease_seconds: 900 })); },
    async releaseLock() { await rpc('release_backend_v2_migration_lock', { p_holder_id: holderId }); },
    async beginRun(args) {
      await ensureContext();
      const row = await rpc('begin_backend_v2_migration_run', { p_environment: args.environment, p_backup_id: args.backupId, p_source_digest: args.sourceDigest, p_plan_digest: args.planDigest, p_counts: args.aggregateCounts });
      return { runId: row.run_id, checkpoint: row.checkpoint, sourceDigest: row.source_digest, planDigest: row.plan_digest };
    },
    async applyBatch(batch) {
      await ensureContext();
      if (!await rpc('claim_backend_v2_migration_lock', { p_holder_id: holderId, p_lease_seconds: 900 })) throw new Error('Migration lock lease lost');
      const items = batch.items.map((item) => transformItem(batch.kind === 'restrictedFinalize' ? 'works' : batch.kind, item));
      const row = await rpc('apply_backend_v2_migration_batch', { p_run_id: batch.runId, p_source_digest: batch.sourceDigest, p_plan_digest: batch.planDigest, p_checkpoint: batch.key, p_kind: batch.kind, p_items: items });
      return { checkpoint: row.checkpoint, credentialsIssued: Number(row.credentials_issued || 0) };
    },
    async copyToPrivate({ sourceKey, destinationKey }) {
      await cosCall(cos, 'copyObject', { Bucket: env.COS_PRIVATE_BUCKET, Region: env.COS_REGION, Key: destinationKey, CopySource: encodeURIComponent(`${env.COS_PUBLIC_BUCKET}.cos.${env.COS_REGION}.myqcloud.com/${sourceKey}`).replace(/%2F/g, '/') });
    },
    async verifyPrivateObject({ objectKey, maxBytes, expectedMimeType }) {
      const hasher = createHash('sha256'); let sizeBytes = 0; let prefix = Buffer.alloc(0); let unsafeText = false;
      const decoder = expectedMimeType.startsWith('text/') ? new TextDecoder('utf-8', { fatal: true }) : null;
      const consume = (chunk) => { const bytes = Buffer.from(chunk); sizeBytes += bytes.length; if (sizeBytes > maxBytes) throw new Error('Private object exceeds declared size'); hasher.update(bytes); if (prefix.length < 16) prefix = Buffer.concat([prefix, bytes.subarray(0, 16 - prefix.length)]); if (decoder) { try { const value = decoder.decode(bytes, { stream: true }); if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) unsafeText = true; } catch { unsafeText = true; } } };
      const output = new Writable({ write(chunk, _encoding, done) { try { consume(chunk); done(); } catch (error) { done(error); } } });
      const result = await cosCall(cos, 'getObject', { Bucket: env.COS_PRIVATE_BUCKET, Region: env.COS_REGION, Key: objectKey, Output: output });
      if (sizeBytes === 0 && result.Body) consume(result.Body);
      if (decoder) { try { decoder.decode(); } catch { unsafeText = true; } }
      return { sizeBytes, checksum: hasher.digest('hex'), mimeType: String(result.headers?.['content-type'] || '').split(';')[0].toLowerCase(), magicValid: magicValid(expectedMimeType, prefix, unsafeText) };
    },
    async collectCheck() {
      await ensureContext();
      const report = await rpc('collect_backend_v2_check', { p_run_id: env.MIGRATION_RUN_ID });
      const manifest = sourceManifest ? await readJson(sourceManifest) : null;
      if (!manifest || !Array.isArray(manifest.works) || !Array.isArray(manifest.assets)) throw new Error('Restricted source manifest is required for reconciliation');
      const restricted = new Set(manifest.works.filter((work) => work.rating === 'restricted').map((work) => work.legacyId));
      const keys = new Set(manifest.assets.filter((asset) => restricted.has(asset.workLegacyId)).map((asset) => asset.publicKey).filter(Boolean));
      const prefixes = new Set(Array.isArray(manifest.restrictedPrefixes) ? manifest.restrictedPrefixes : [...keys].map((key) => String(key).includes('/') ? `${String(key).split('/').slice(0, -1).join('/')}/` : String(key)));
      if (restricted.size && !prefixes.size) throw new Error('Restricted source prefixes are required for reconciliation');
      if ([...keys].some((key) => ![...prefixes].some((prefix) => typeof prefix === 'string' && key.startsWith(prefix)))) throw new Error('Restricted source prefix does not cover every canonical object');
      const visible = new Set();
      for (const prefix of prefixes) {
        if (typeof prefix !== 'string' || !prefix || prefix.includes('..') || prefix.startsWith('/')) throw new Error('Restricted source prefix is invalid');
        let marker;
        do {
          const page = await cosCall(cos, 'getBucket', { Bucket: env.COS_PUBLIC_BUCKET, Region: env.COS_REGION, Prefix: prefix, Marker: marker, MaxKeys: 1000 });
          for (const object of page.Contents || []) if (typeof object.Key === 'string') visible.add(object.Key);
          marker = page.IsTruncated === 'true' || page.IsTruncated === true ? page.NextMarker : null;
          if (marker !== null && typeof marker !== 'string') throw new Error('COS listing did not provide a continuation marker');
        } while (marker);
      }
      report.invariants.publicRestrictedObjects += visible.size;
      const snapshots = await rpc('collect_backend_v2_snapshot_manifest', {});
      if (!Array.isArray(snapshots)) throw new Error('Snapshot reconciliation manifest is invalid');
      for (const pointer of snapshots) {
        try {
          const object = await cosCall(cos, 'getObject', { Bucket: env.COS_PUBLIC_BUCKET, Region: env.COS_REGION, Key: pointer.objectKey });
          const body = Buffer.from(object.Body || ''); const checksum = createHash('sha256').update(body).digest('hex');
          const document = JSON.parse(body.toString('utf8'));
          if (checksum !== pointer.checksum || document.version !== Number(pointer.version) || document.schemaVersion !== 1) report.invariants.snapshotDrift += 1;
        } catch (error) {
          if (isMissingObject(error) || error instanceof SyntaxError) report.invariants.snapshotDrift += 1;
          else throw error;
        }
      }
      return report;
    },
    async exportCredentialEnvelopes(runId) {
      await ensureContext();
      const result = await rpc('export_backend_v2_credential_envelopes', { p_run_id: runId });
      if (!Array.isArray(result) || result.some((entry) => !entry || Object.keys(entry).length !== 1 || typeof entry.ciphertext !== 'string')) throw new Error('Credential envelope export is invalid');
      return result;
    },
    async readCosConfiguration() {
      await ensureContext();
      const optionalCos = async (method, params, missingCodes) => { try { return await cosCall(cos, method, params); } catch (error) { if (missingCodes.includes(String(error?.code || error?.statusCode))) return null; throw error; } };
      const readBucket = async (bucket, { lifecycle = false, policy = false } = {}) => {
        const params = { Bucket: bucket, Region: env.COS_REGION };
        const [acl, cors, lifecycleResult, policyResult] = await Promise.all([
          cosCall(cos, 'getBucketAcl', params), cosCall(cos, 'getBucketCors', params),
          lifecycle ? optionalCos('getBucketLifecycle', params, ['NoSuchLifecycleConfiguration','404']) : null,
          policy ? optionalCos('getBucketPolicy', params, ['NoSuchBucketPolicy','NoSuchPolicy','404']) : null,
        ]);
        let websiteEnabled = true;
        try { await cosCall(cos, 'getBucketWebsite', { Bucket: bucket, Region: env.COS_REGION }); }
        catch (error) { if (['NoSuchWebsiteConfiguration','NoSuchWebsite','404'].includes(String(error?.code || error?.statusCode))) websiteEnabled = false; else throw error; }
        const grants = acl?.ACL?.Grants || acl?.Grants || [];
        const rules = cors?.CORSRules || cors?.CORSConfiguration?.CORSRules || [];
        const staging = (lifecycleResult?.Rules || lifecycleResult?.LifecycleConfiguration?.Rules || []).find((rule) => rule?.Filter?.Prefix === 'staging/' || rule?.Prefix === 'staging/');
        let publicPolicy = null;
        if (policyResult) {
          const document = typeof policyResult.Policy === 'string' ? JSON.parse(policyResult.Policy) : policyResult.Policy || policyResult;
          const statements = Array.isArray(document?.Statement) ? document.Statement : Array.isArray(document?.statement) ? document.statement : [];
          const isAnonymous = (statement) => /(?:anyone:anyone|"\*")/i.test(JSON.stringify(statement?.Principal ?? statement?.principal ?? ''));
          const anonymousAllow = statements.filter((statement) => String(statement?.Effect ?? statement?.effect).toLowerCase() === 'allow' && isAnonymous(statement));
          const anonymousDeny = statements.filter((statement) => String(statement?.Effect ?? statement?.effect).toLowerCase() === 'deny' && isAnonymous(statement));
          const actions = [...new Set(anonymousAllow.flatMap((statement) => { const value = statement.Action ?? statement.action; return Array.isArray(value) ? value : [value]; }).filter((value) => typeof value === 'string'))].sort();
          const resources = [...new Set(anonymousAllow.flatMap((statement) => { const value = statement.Resource ?? statement.resource; return Array.isArray(value) ? value : [value]; }).filter((value) => typeof value === 'string').map((value) => { const marker = `:${bucket}/`; const offset = value.indexOf(marker); return offset < 0 ? `invalid:${value}` : value.slice(offset + marker.length); }))].sort();
          publicPolicy = { anonymousActions: actions, anonymousResources: resources, allowedGetObjectPrefixes: actions.length === 1 && actions[0] === 'name/cos:GetObject' ? resources : [], anonymousDenyCount: anonymousDeny.length, conditionalAllowCount: anonymousAllow.filter((statement) => statement.Condition !== undefined || statement.condition !== undefined).length };
        }
        return { publicGrant: grants.some((grant) => /AllUsers|AllAuthenticatedUsers/i.test(String(grant?.Grantee?.URI || grant?.Grantee?.ID || ''))), websiteEnabled, cors: { origins: [...new Set(rules.flatMap((rule) => rule.AllowedOrigins || rule.AllowedOrigin || []))], methods: [...new Set(rules.flatMap((rule) => rule.AllowedMethods || rule.AllowedMethod || []))], headers: [...new Set(rules.flatMap((rule) => rule.AllowedHeaders || rule.AllowedHeader || []))] }, stagingLifecycle: staging ? { prefix: staging?.Filter?.Prefix || staging?.Prefix, expirationDays: Number(staging?.Expiration?.Days) } : null, publicPolicy };
      };
      const [privateBucket, publicBucket] = await Promise.all([readBucket(env.COS_PRIVATE_BUCKET, { lifecycle: true }), readBucket(env.COS_PUBLIC_BUCKET, { policy: true })]);
      return {
        privatePublicGrant: privateBucket.publicGrant, privateWebsiteEnabled: privateBucket.websiteEnabled, privateCors: privateBucket.cors, stagingLifecycle: privateBucket.stagingLifecycle,
        publicBucketPublicGrant: publicBucket.publicGrant, publicWebsiteEnabled: publicBucket.websiteEnabled, publicCors: publicBucket.cors, publicPolicy: publicBucket.publicPolicy,
      };
    },
    async claimDeletion({ manifestDigest, sourceKey, privateKey, backupId, checksum }) {
      await ensureContext();
      if (!await rpc('claim_backend_v2_migration_lock', { p_holder_id: holderId, p_lease_seconds: 900 })) throw new Error('Cutover lock lease lost');
      const row = await rpc('claim_public_asset_deletion', { p_holder_id: holderId, p_manifest_digest: manifestDigest, p_source_key_hash: keyHash('public-object', sourceKey), p_private_key: privateKey, p_private_key_hash: keyHash('private-object', privateKey), p_backup_id: backupId, p_checksum: checksum });
      return { state: row.state, fencingToken: Number(row.fencing_token) };
    },
    async deletePublicObject(sourceKey) { await cosCall(cos, 'deleteObject', { Bucket: env.COS_PUBLIC_BUCKET, Region: env.COS_REGION, Key: sourceKey }); },
    async finalizeDeletion({ manifestDigest, sourceKey, fencingToken }) { return rpc('finalize_public_asset_deletion', { p_holder_id: holderId, p_manifest_digest: manifestDigest, p_source_key_hash: keyHash('public-object', sourceKey), p_fencing_token: fencingToken }); },
  };
}

export async function createMigrationAdapter(options = {}) { return createAdapterRuntime({ expectedEnvironment: options.environment }); }
export async function collectBackendV2Check() { return (await createMigrationAdapter()).collectCheck(); }
export async function createRestrictedCutoverAdapter(options = {}) { return createAdapterRuntime({ expectedEnvironment: options.environment }); }
