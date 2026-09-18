#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

function parse(argv) {
  const flags = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) throw new Error('Restricted cutover refused: unsupported argument');
    const [key, ...rest] = arg.slice(2).split('=');
    if (flags.has(key)) throw new Error('Restricted cutover refused: duplicate option');
    flags.set(key, rest.length ? rest.join('=') : true);
  }
  return flags;
}

export function parseRestrictedCutoverArgs(argv) {
  const flags = parse(argv);
  const allowed = new Set(['apply','environment','manifest','manifest-sha256','backup-id','ack','prod-confirm','adapter']);
  if ([...flags.keys()].some((key) => !allowed.has(key)) || flags.get('apply') !== true) throw new Error('Restricted cutover refused: apply must be explicit');
  const environment = flags.get('environment');
  if (!['nonprod','prod'].includes(environment) || typeof flags.get('manifest') !== 'string' || !/^[a-f0-9]{64}$/.test(String(flags.get('manifest-sha256') || ''))
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(String(flags.get('backup-id') || '')) || flags.get('ack') !== 'DELETE_VERIFIED_PUBLIC_R18_SOURCES'
    || typeof flags.get('adapter') !== 'string') throw new Error('Restricted cutover refused: backup, immutable manifest, adapter, and acknowledgement are required');
  if (environment === 'prod' && flags.get('prod-confirm') !== 'PRODUCTION_R18_PUBLIC_DELETE') throw new Error('Restricted cutover refused: production confirmation is required');
  return { apply: true, environment, manifest: flags.get('manifest'), manifestSha256: flags.get('manifest-sha256'), backupId: flags.get('backup-id'), adapter: flags.get('adapter') };
}

function validEntry(entry) {
  return entry && entry.privateVerified === true && /^media\/[A-Za-z0-9._/-]+$/.test(entry.sourceKey || '')
    && /^protected\/works\/[A-Za-z0-9._/-]+$/.test(entry.privateKey || '') && /^[a-f0-9]{64}$/.test(entry.checksum || '')
    && !String(entry.sourceKey).split('/').some((part) => !part || part === '.' || part === '..')
    && !String(entry.privateKey).split('/').some((part) => !part || part === '.' || part === '..')
    && Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes > 0 && typeof entry.mimeType === 'string';
}

export async function runRestrictedCutover({ options, manifest, adapter }) {
  const objects = Array.isArray(manifest?.objects) ? manifest.objects : [];
  const sources = objects.map((entry) => entry?.sourceKey); const destinations = objects.map((entry) => entry?.privateKey);
  if (!options.apply || manifest?.version !== 1 || manifest.backupId !== options.backupId || !objects.length || objects.some((entry) => !validEntry(entry))
    || new Set(sources).size !== sources.length || new Set(destinations).size !== destinations.length) throw new Error('Restricted cutover refused: manifest is invalid');
  const manifestDigest = options.manifestSha256 || createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  if (typeof adapter.acquireLock !== 'function' || typeof adapter.claimDeletion !== 'function' || typeof adapter.finalizeDeletion !== 'function') throw new Error('Restricted cutover refused: durable adapter is required');
  if (!await adapter.acquireLock({ manifestDigest, backupId: options.backupId })) throw new Error('Restricted cutover refused: cutover lock unavailable');
  let deleted = 0; let skipped = 0;
  try {
    for (const entry of objects) {
      const claim = await adapter.claimDeletion({ manifestDigest, backupId: options.backupId, sourceKey: entry.sourceKey, privateKey: entry.privateKey, checksum: entry.checksum });
      if (claim?.state === 'completed') { skipped += 1; continue; }
      if (claim?.state !== 'claimed' || !Number.isSafeInteger(claim.fencingToken) || claim.fencingToken < 1) throw new Error('Restricted cutover refused: deletion claim failed');
      const actual = await adapter.verifyPrivateObject({ objectKey: entry.privateKey, maxBytes: entry.sizeBytes, expectedMimeType: entry.mimeType });
      if (!actual?.magicValid || actual.sizeBytes !== entry.sizeBytes || actual.checksum !== entry.checksum || String(actual.mimeType).toLowerCase() !== entry.mimeType.toLowerCase()) throw new Error('Restricted cutover refused: private verification failed');
      await adapter.deletePublicObject(entry.sourceKey);
      await adapter.finalizeDeletion({ manifestDigest, sourceKey: entry.sourceKey, privateKey: entry.privateKey, backupId: options.backupId, checksum: entry.checksum, fencingToken: claim.fencingToken });
      deleted += 1;
    }
  } finally {
    await adapter.releaseLock({ manifestDigest, backupId: options.backupId });
  }
  return { deleted, skipped };
}

async function main() {
  try {
    const options = parseRestrictedCutoverArgs(process.argv.slice(2));
    const raw = await readFile(options.manifest);
    if (createHash('sha256').update(raw).digest('hex') !== options.manifestSha256) throw new Error('Restricted cutover refused: manifest checksum mismatch');
    const module = await import(pathToFileURL(options.adapter).href);
    if (typeof module.createRestrictedCutoverAdapter !== 'function') throw new Error('Restricted cutover adapter is invalid');
    const result = await runRestrictedCutover({ options, manifest: JSON.parse(raw.toString('utf8')), adapter: await module.createRestrictedCutoverAdapter(options) });
    process.stdout.write(`restricted public-source cutover completed: deleted=${result.deleted}\n`);
  } catch (error) {
    const message = error instanceof Error && /^Restricted cutover refused/.test(error.message) ? error.message : 'Restricted cutover dependency failed; inspect protected platform logs';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
