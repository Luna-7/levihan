#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export async function buildR18CutoverManifest({ source, backupId, adapter }) {
  if (!source || !Array.isArray(source.works) || !Array.isArray(source.assets) || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(backupId)) throw new Error('R18 manifest source is invalid');
  const restricted = new Set(source.works.filter((work) => work?.rating === 'restricted').map((work) => work.legacyId));
  const candidates = source.assets.filter((asset) => restricted.has(asset?.workLegacyId));
  if (!candidates.length) throw new Error('R18 manifest has no restricted assets');
  const objects = [];
  for (const asset of candidates) {
    if (!asset.publicKey || !asset.privateKey || !asset.checksum || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1 || !asset.mimeType) throw new Error('R18 manifest asset metadata is incomplete');
    const actual = await adapter.verifyPrivateObject({ objectKey: asset.privateKey, maxBytes: asset.sizeBytes, expectedMimeType: asset.mimeType });
    if (!actual?.magicValid || actual.sizeBytes !== asset.sizeBytes || actual.checksum !== asset.checksum || actual.mimeType !== asset.mimeType) throw new Error('R18 private asset verification failed');
    objects.push({ sourceKey: asset.publicKey, privateKey: asset.privateKey, checksum: asset.checksum, sizeBytes: asset.sizeBytes, mimeType: asset.mimeType, privateVerified: true });
  }
  objects.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  if (new Set(objects.map((item) => item.sourceKey)).size !== objects.length || new Set(objects.map((item) => item.privateKey)).size !== objects.length) throw new Error('R18 manifest contains duplicate object keys');
  return { version: 1, backupId, objects };
}

function flags(argv) { return Object.fromEntries(argv.map((arg) => { if (!arg.startsWith('--') || !arg.includes('=')) throw new Error('R18 manifest option invalid'); const [key, ...value] = arg.slice(2).split('='); return [key, value.join('=')]; })); }

async function main() {
  try {
    const options = flags(process.argv.slice(2));
    if (!['nonprod','prod'].includes(options.environment) || !options['source-manifest'] || !options.output || !options.adapter || !options['backup-id']) throw new Error('R18 manifest requires environment, source, output, backup, and adapter');
    const source = JSON.parse(await readFile(options['source-manifest'], 'utf8'));
    const module = await import(pathToFileURL(options.adapter).href);
    const adapter = await module.createRestrictedCutoverAdapter({ environment: options.environment });
    const manifest = await buildR18CutoverManifest({ source, backupId: options['backup-id'], adapter });
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(options.output, bytes, { mode: 0o600, flag: 'wx' });
    process.stdout.write(`R18 cutover manifest created: count=${manifest.objects.length} sha256=${createHash('sha256').update(bytes).digest('hex')}\n`);
  } catch (error) {
    process.stderr.write(`R18 cutover manifest failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
