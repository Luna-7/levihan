#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const COUNT_KEYS = ['users', 'works', 'chapters', 'assets', 'comments', 'forumPosts', 'leaderboardEntries'];
const INVARIANTS = Object.freeze({
  orphanForeignKeys: ['ORPHAN_FOREIGN_KEY', 'critical'], duplicateKeys: ['DUPLICATE_KEY', 'critical'],
  uuidShapedSlugs: ['UUID_SHAPED_SLUG', 'critical'], invalidStates: ['INVALID_STATE', 'critical'],
  invalidAssets: ['INVALID_ASSET', 'critical'], snapshotDrift: ['SNAPSHOT_DRIFT', 'warning'],
  publicRestrictedObjects: ['R18_PUBLIC_OBJECT', 'critical'], recoveryStateMissing: ['RECOVERY_STATE_MISSING', 'critical'],
});

const ROOT_KEYS = new Set(['schemaVersion','sourceSnapshotId','migrationRunId','targetSchemaVersion','source','target','invariants']);
function strictCountObject(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key) || !Number.isSafeInteger(value[key]) || value[key] < 0)) {
    throw new Error(`Invalid reconciliation input: ${label}`);
  }
  return value;
}

function validateInput(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some((key) => !ROOT_KEYS.has(key))
    || input.schemaVersion !== 1
    || typeof input.sourceSnapshotId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(input.sourceSnapshotId)
    || typeof input.migrationRunId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.migrationRunId)
    || input.targetSchemaVersion !== '20260918_backend_v2_cutover') throw new Error('Invalid reconciliation input: envelope');
  strictCountObject(input.source, COUNT_KEYS, 'source counts');
  strictCountObject(input.target, COUNT_KEYS, 'target counts');
  strictCountObject(input.invariants, Object.keys(INVARIANTS), 'invariants');
  if (input.source.works < 1 || input.source.assets < 1) throw new Error('Invalid reconciliation input: source snapshot is unexpectedly empty');
}

export function checkBackendV2(input) {
  validateInput(input);
  const issues = [];
  for (const key of COUNT_KEYS) {
    const source = input.source[key]; const target = input.target[key];
    if (source !== target) issues.push({ code: 'COUNT_MISMATCH', severity: 'critical', subject: key, source, target });
  }
  for (const [key, [code, severity]] of Object.entries(INVARIANTS)) {
    const count = input.invariants[key];
    if (count > 0) issues.push({ code, severity, subject: key, count });
  }
  const summary = { critical: issues.filter((item) => item.severity === 'critical').length, warning: issues.filter((item) => item.severity === 'warning').length };
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), sourceSnapshotId: input.sourceSnapshotId, migrationRunId: input.migrationRunId, targetSchemaVersion: input.targetSchemaVersion, source: input.source, target: input.target, issues, summary, exitCode: summary.critical ? 3 : summary.warning ? 2 : 0 };
}

export function formatCheckReport(report, { json = false } = {}) {
  const safe = { schemaVersion: report.schemaVersion, checkedAt: report.checkedAt, sourceSnapshotId: report.sourceSnapshotId, migrationRunId: report.migrationRunId, targetSchemaVersion: report.targetSchemaVersion, source: report.source, target: report.target, issues: report.issues, summary: report.summary, exitCode: report.exitCode };
  if (json) return JSON.stringify(safe);
  return [`Backend v2 reconciliation: critical=${safe.summary.critical} warning=${safe.summary.warning}`, ...safe.issues.map((item) => `- ${item.severity.toUpperCase()} ${item.code} ${item.subject}: ${item.count ?? `${item.source}->${item.target}`}`)].join('\n');
}

function args(argv) {
  const result = { json: false, input: null, adapter: null };
  for (const value of argv) {
    if (value === '--json') result.json = true;
    else if (value.startsWith('--input=')) result.input = value.slice(8);
    else if (value.startsWith('--adapter=')) result.adapter = value.slice(10);
    else throw new Error('unsupported checker argument');
  }
  if (Boolean(result.input) === Boolean(result.adapter)) throw new Error('exactly one --input or --adapter is required');
  return result;
}

async function main() {
  try {
    const options = args(process.argv.slice(2));
    let input;
    if (options.input) input = JSON.parse(await readFile(options.input, 'utf8'));
    else {
      const module = await import(pathToFileURL(options.adapter).href);
      if (typeof module.collectBackendV2Check !== 'function') throw new Error('checker adapter must export collectBackendV2Check');
      input = await module.collectBackendV2Check();
    }
    const report = checkBackendV2(input);
    process.stdout.write(`${formatCheckReport(report, options)}\n`);
    process.exitCode = report.exitCode;
  } catch (error) {
    const message = error instanceof Error && /^(unsupported checker argument|exactly one|checker adapter)/.test(error.message) ? error.message : 'checker input or dependency failed';
    process.stderr.write(`backend-v2 check failed: ${message}\n`);
    process.exitCode = 4;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
