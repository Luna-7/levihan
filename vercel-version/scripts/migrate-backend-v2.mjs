#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';

const APPLY_ACK = 'MIGRATE_BACKEND_V2';
const PROD_ACK = 'PRODUCTION_BACKEND_V2_CUTOVER';
const KINDS = ['users', 'works', 'chapters', 'assets', 'comments', 'forumPosts', 'leaderboardEntries'];
const COUNT_NAMES = Object.freeze({ users: 'legacy_users', works: 'works', chapters: 'chapters', assets: 'assets', comments: 'comments', forumPosts: 'forum_posts', leaderboardEntries: 'leaderboard_entries' });

function flagMap(argv) {
  const values = new Map();
  for (const value of argv) {
    if (!value.startsWith('--')) throw new Error(`Migration refused: unsupported argument`);
    const [name, ...parts] = value.slice(2).split('=');
    if (values.has(name)) throw new Error(`Migration refused: duplicate --${name}`);
    values.set(name, parts.length ? parts.join('=') : true);
  }
  return values;
}

export function parseMigrationArgs(argv) {
  const flags = flagMap(argv);
  const allowed = new Set(['apply', 'environment', 'backup-id', 'ack', 'prod-confirm', 'batch-size', 'adapter', 'source-manifest', 'json', 'cutover-delete-public']);
  for (const key of flags.keys()) if (!allowed.has(key)) throw new Error('Migration refused: unsupported option');
  const apply = flags.get('apply') === true;
  const environment = flags.get('environment');
  const backupId = flags.get('backup-id');
  const batchSize = flags.has('batch-size') ? Number(flags.get('batch-size')) : 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('Migration refused: invalid batch size');
  if (apply) {
    if (!['nonprod', 'prod'].includes(environment) || typeof backupId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(backupId) || flags.get('ack') !== APPLY_ACK) throw new Error('Migration refused: apply requires environment, backup ID, and exact acknowledgement');
    if (environment === 'prod' && flags.get('prod-confirm') !== PROD_ACK) throw new Error('Migration refused: production confirmation is required');
    if (!flags.get('adapter')) throw new Error('Migration refused: apply requires an explicit adapter');
  }
  if (flags.has('cutover-delete-public')) throw new Error('Migration refused: public source deletion is a separate cutover command');
  return Object.freeze({
    apply, environment: apply ? environment : 'dry-run', backupId: apply ? backupId : null, batchSize,
    adapter: typeof flags.get('adapter') === 'string' ? flags.get('adapter') : null,
    sourceManifest: typeof flags.get('source-manifest') === 'string' ? flags.get('source-manifest') : null,
    json: flags.has('json'), deletePublicSource: false,
  });
}

function rows(source, kind) { return Array.isArray(source?.[kind]) ? source[kind] : []; }
function conflicts(source) {
  const result = [];
  const slugs = new Set();
  for (const work of rows(source, 'works')) {
    const slug = String(work.slug || '').toLowerCase();
    if (slugs.has(slug)) result.push('duplicate_work_slug');
    slugs.add(slug);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug)) result.push('uuid_shaped_slug');
  }
  const workIds = new Set(rows(source, 'works').map((item) => item.legacyId));
  const chapterIds = new Set(rows(source, 'chapters').map((item) => item.legacyId));
  if (rows(source, 'chapters').some((item) => !workIds.has(item.workLegacyId))) result.push('orphan_chapter');
  if (rows(source, 'assets').some((item) => !workIds.has(item.workLegacyId))) result.push('orphan_asset');
  if (rows(source, 'assets').some((item) => item.chapterLegacyId && !chapterIds.has(item.chapterLegacyId))) result.push('orphan_asset_chapter');
  if (rows(source, 'assets').some((item) => !/^[a-f0-9]{64}$/.test(item.checksum || '') || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1)) result.push('missing_asset_metadata');
  const restrictedIds = new Set(rows(source, 'works').filter((item) => item.rating === 'restricted').map((item) => item.legacyId));
  if (rows(source, 'assets').some((item) => restrictedIds.has(item.workLegacyId)
    ? !String(item.privateKey || '').startsWith('protected/works/')
    : item.storageZone !== 'public' || item.accessLevel !== 'public' || !String(item.objectKey || '').startsWith('media/works/'))) result.push('invalid_asset_target');
  return [...new Set(result)].sort();
}

function counts(source) { return Object.fromEntries(KINDS.map((kind) => [COUNT_NAMES[kind], rows(source, kind).length])); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }

export function safeMigrationSummary(report) {
  return {
    mode: report.mode, environment: report.environment, counts: report.counts,
    conflicts: report.conflicts, batchesCompleted: report.batchesCompleted,
    restricted: report.restricted, ...(report.runId ? { runId: report.runId } : {}),
  };
}

function objectMatches(asset, metadata) {
  return Boolean(metadata?.magicValid) && Number(metadata.sizeBytes) === Number(asset.sizeBytes)
    && metadata.checksum === asset.checksum && String(metadata.mimeType || '').toLowerCase() === String(asset.mimeType || '').toLowerCase();
}

function hasCompleteRestrictedAssets(work, assets) {
  if (!assets.length || assets.some((asset) => !asset.privateKey?.startsWith('protected/works/') || !/^[a-f0-9]{64}$/.test(asset.checksum || '') || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1)) return false;
  if (work.type === 'comic') {
    const pages = assets.filter((asset) => asset.kind === 'page').map((asset) => asset.pageNo).sort((a, b) => a - b);
    return assets.some((asset) => asset.kind === 'cover') && pages.length > 0 && pages.every((page, index) => page === index + 1);
  }
  if (work.type === 'novel') return assets.some((asset) => asset.kind === 'cover') && assets.some((asset) => asset.kind === 'body');
  return assets.some((asset) => ['body','attachment','page'].includes(asset.kind));
}
function migratedAssetDigest(assets, chapters) {
  const chapterPositions = new Map(chapters.map((chapter) => [chapter.legacyId, chapter.position]));
  const rows = assets.map((asset) => [asset.privateKey || asset.objectKey, asset.checksum, asset.kind, asset.mimeType, asset.sizeBytes, asset.pageNo || '', asset.chapterLegacyId ? chapterPositions.get(asset.chapterLegacyId) ?? 'missing' : ''].join('\t')).sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

function makeBatches(source, batchSize, publishRestricted) {
  const result = [];
  const restrictedWorkIds = new Set(rows(source, 'works').filter((work) => work.rating === 'restricted').map((work) => work.legacyId));
  const normalize = (kind, item) => {
    if (kind === 'users') return {
      legacyId: item.legacyId, username: String(item.username || '').trim().toLowerCase(),
      role: item.role === 'admin' ? 'admin' : 'member', status: ['active','suspended','deleted'].includes(item.status) ? item.status : 'suspended',
      credentialState: 'migration_required', requiresCredentialSetup: true,
    };
    if (kind === 'works') return { ...item, status: item.rating === 'restricted' ? 'draft' : item.status };
    if (kind === 'assets' && restrictedWorkIds.has(item.workLegacyId)) return { ...item, objectKey: item.privateKey, storageZone: 'private', accessLevel: 'private', status: publishRestricted ? 'active' : 'staging' };
    return item;
  };
  for (const kind of KINDS) {
    const items = rows(source, kind).map((item) => normalize(kind, item));
    for (let offset = 0; offset < items.length; offset += batchSize) result.push({
      key: `${kind}:${offset / batchSize}`, kind, items: items.slice(offset, offset + batchSize),
      // Restricted works enter as draft. Only the adapter's final asset transaction
      // may bind active/private metadata and publish after re-verifying completeness.
      publishRestricted: false, finalizeRestricted: false,
    });
  }
  const publicPublished = rows(source, 'works').filter((work) => work.rating !== 'restricted' && work.status === 'published');
  if (publicPublished.length) result.push({ key: 'publicFinalize:0', kind: 'publicFinalize', items: publicPublished.map((work) => ({ legacyId: work.legacyId, publishedAt: work.publishedAt || null, assetSetHash: migratedAssetDigest(rows(source, 'assets').filter((asset) => asset.workLegacyId === work.legacyId), rows(source, 'chapters').filter((chapter) => chapter.workLegacyId === work.legacyId)) })), publishRestricted: false, finalizeRestricted: false });
  if (publishRestricted) result.push({
    key: 'restrictedFinalize:0', kind: 'restrictedFinalize',
    items: rows(source, 'works').filter((work) => work.rating === 'restricted').map((work) => ({ legacyId: work.legacyId, assetSetHash: migratedAssetDigest(rows(source, 'assets').filter((asset) => asset.workLegacyId === work.legacyId), rows(source, 'chapters').filter((chapter) => chapter.workLegacyId === work.legacyId)) })),
    publishRestricted: true, finalizeRestricted: true,
  });
  result.push({ key: 'migrationComplete:0', kind: 'migrationComplete', items: [], publishRestricted: false, finalizeRestricted: false });
  return result;
}

export async function runBackendMigration({ options, adapter }) {
  if (!adapter || typeof adapter.readSource !== 'function') throw new Error('Migration adapter is unavailable');
  const rawSource = await adapter.readSource();
  const source = Object.fromEntries(KINDS.map((kind) => [kind, rows(rawSource, kind).slice().sort((left, right) => String(left.legacyId || '').localeCompare(String(right.legacyId || '')))]));
  const report = { mode: options.apply ? 'apply' : 'dry-run', environment: options.environment, counts: counts(source), conflicts: conflicts(source), batchesCompleted: 0, restricted: { eligible: 0, heldDraft: 0 } };
  if (!options.apply) {
    if (typeof adapter.readTargetSummary === 'function') await adapter.readTargetSummary();
    return report;
  }
  if (report.conflicts.length) throw new Error(`Migration preflight refused apply: ${report.conflicts.join(',')}`);

  const locked = await adapter.acquireLock('levihan-backend-v2-migration');
  if (!locked) throw new Error('Migration lock unavailable');
  try {
    const restrictedWorks = rows(source, 'works').filter((work) => work.rating === 'restricted');
    const restrictedAssets = rows(source, 'assets').filter((asset) => rows(source, 'works').some((work) => work.legacyId === asset.workLegacyId && work.rating === 'restricted'));
    let publishRestricted = restrictedWorks.length > 0 && restrictedWorks.every((work) => hasCompleteRestrictedAssets(work, restrictedAssets.filter((asset) => asset.workLegacyId === work.legacyId)));
    for (const asset of restrictedAssets) {
      if (typeof adapter.copyToPrivate !== 'function' || typeof adapter.verifyPrivateObject !== 'function') { publishRestricted = false; break; }
      await adapter.copyToPrivate({ sourceKey: asset.publicKey, destinationKey: asset.privateKey, expectedSize: asset.sizeBytes, expectedChecksum: asset.checksum });
      const metadata = await adapter.verifyPrivateObject({ objectKey: asset.privateKey, maxBytes: asset.sizeBytes, expectedMimeType: asset.mimeType });
      if (!objectMatches(asset, metadata)) publishRestricted = false;
    }
    if (restrictedAssets.length === 0) publishRestricted = false;
    report.restricted[publishRestricted ? 'eligible' : 'heldDraft'] = restrictedWorks.length;

    const batches = makeBatches(source, options.batchSize, publishRestricted);
    const sourceDigest = digest(Object.fromEntries(KINDS.map((kind) => [kind, rows(source, kind)])));
    const planDigest = digest({ batchSize: options.batchSize, batches });
    if (typeof adapter.beginRun !== 'function') throw new Error('Migration adapter must persist a digest-bound run');
    const run = await adapter.beginRun({ environment: options.environment, backupId: options.backupId, sourceDigest, planDigest, aggregateCounts: Object.fromEntries(KINDS.map((kind) => [kind, rows(source, kind).length])) });
    if (!run || typeof run.runId !== 'string' || run.sourceDigest !== sourceDigest || run.planDigest !== planDigest) throw new Error('Migration adapter returned a mismatched run');
    report.runId = run.runId;
    const checkpoint = run.checkpoint || null;
    const checkpointIndex = checkpoint ? batches.findIndex((batch) => batch.key === checkpoint) : -1;
    if (checkpoint && checkpointIndex < 0) throw new Error('Migration checkpoint does not belong to this immutable plan');
    const start = checkpointIndex + 1;
    for (const batch of batches.slice(Math.max(0, start))) {
      // The adapter must wrap each batch plus checkpoint update in one DB transaction.
      const committed = await adapter.applyBatch({ ...batch, runId: run.runId, sourceDigest, planDigest, backupId: options.backupId, environment: options.environment, restrictedFallbackStatus: 'draft' });
      if (!committed || committed.checkpoint !== batch.key) throw new Error('Migration adapter did not atomically commit the expected checkpoint');
      if (batch.kind === 'users' && committed.credentialsIssued !== batch.items.length) throw new Error('Migration adapter did not issue every controlled legacy credential');
      report.batchesCompleted += 1;
    }
    return report;
  } finally {
    await adapter.releaseLock('levihan-backend-v2-migration');
  }
}

async function loadAdapter(options) {
  if (options.adapter) {
    const module = await import(pathToFileURL(options.adapter).href);
    if (typeof module.createMigrationAdapter !== 'function') throw new Error('Migration adapter must export createMigrationAdapter');
    return module.createMigrationAdapter({ environment: options.environment, backupId: options.backupId });
  }
  if (options.sourceManifest) {
    const source = JSON.parse(await readFile(options.sourceManifest, 'utf8'));
    return { readSource: async () => source, readTargetSummary: async () => ({}) };
  }
  return { readSource: loadRepositoryLegacySource, readTargetSummary: async () => ({}) };
}

export async function loadRepositoryLegacySource(repositoryRoot = resolve(import.meta.dirname, '..')) {
  const readArray = async (path) => {
    try { const value = JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8')); return Array.isArray(value) ? value : []; }
    catch (error) { if (error && error.code === 'ENOENT') return []; throw error; }
  };
  const archive = await readArray('archive/archive.json');
  const recommendations = await readArray('archive/recs.json');
  const works = archive.map((item) => ({ legacyId: String(item.id), slug: String(item.id).toLowerCase(), type: String(item.category || '').includes('小说') ? 'novel' : 'comic', rating: String(item.rating || '').toLowerCase() === 'r18' ? 'restricted' : 'general', status: 'draft', title: String(item.titleZh || item.title || item.id), authorName: String(item.circle || 'legacy') }));
  const assets = archive.flatMap((item) => {
    const total = Number.isSafeInteger(item.pages) && item.pages > 0 ? item.pages : 0;
    const cover = item.coverFile ? [{ legacyId: `${item.id}:cover`, workLegacyId: String(item.id), kind: 'cover', publicKey: `${item.bookFolder}/${item.coverFile}`, sizeBytes: null, checksum: null, mimeType: 'image/webp' }] : [];
    return [...cover, ...Array.from({ length: total }, (_, index) => ({ legacyId: `${item.id}:page:${index + 1}`, workLegacyId: String(item.id), kind: 'page', pageNo: index + 1, publicKey: `${item.bookFolder}/page-${index + 1}`, sizeBytes: null, checksum: null, mimeType: 'image/webp' }))];
  });
  for (const item of recommendations) works.push({ legacyId: String(item.id), slug: String(item.id).toLowerCase().replace(/[^a-z0-9-]/g, '-'), type: 'resource', rating: ['r','explicit'].includes(String(item.rating || '').toLowerCase()) ? 'mature' : 'general', status: 'draft', title: String(item.title || item.id), authorName: String(item.site || 'legacy') });
  return { users: [], works, chapters: [], assets, comments: [], forumPosts: [], leaderboardEntries: [] };
}

async function main() {
  try {
    const options = parseMigrationArgs(process.argv.slice(2));
    const report = await runBackendMigration({ options, adapter: await loadAdapter(options) });
    const safe = safeMigrationSummary(report);
    process.stdout.write(options.json ? `${JSON.stringify(safe)}\n` : `backend-v2 ${safe.mode}: ${JSON.stringify(safe.counts)}; conflicts=${safe.conflicts.join(',') || 'none'}; restricted=${JSON.stringify(safe.restricted)}\n`);
  } catch (error) {
    const message = error instanceof Error && /^(Migration refused|Migration lock unavailable|Migration adapter|Migration adapter did not)/.test(error.message) ? error.message : 'Migration dependency failed; inspect protected platform logs by request/run ID';
    process.stderr.write(`backend-v2 migration failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
