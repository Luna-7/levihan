import { describe, expect, it } from 'vitest';
import { checkBackendV2, formatCheckReport } from './check-backend-v2.mjs';

const healthy = {
  schemaVersion: 1,
  sourceSnapshotId: 'snapshot-20260918-a',
  migrationRunId: '11111111-1111-4111-8111-111111111111',
  targetSchemaVersion: '20260918_backend_v2_cutover',
  source: { users: 2, works: 3, chapters: 4, assets: 8, comments: 4, forumPosts: 2, leaderboardEntries: 5 },
  target: { users: 2, works: 3, chapters: 4, assets: 8, comments: 4, forumPosts: 2, leaderboardEntries: 5 },
  invariants: { orphanForeignKeys: 0, duplicateKeys: 0, uuidShapedSlugs: 0, invalidStates: 0, invalidAssets: 0, snapshotDrift: 0, publicRestrictedObjects: 0, recoveryStateMissing: 0 },
};

describe('backend v2 reconciliation checker', () => {
  it.each([
    {},
    { ...healthy, source: { ...healthy.source, users: undefined } },
    { ...healthy, target: { ...healthy.target, users: -1 } },
    { ...healthy, invariants: { ...healthy.invariants, orphanForeignKeys: Number.NaN } },
    { ...healthy, invariants: { ...healthy.invariants, unexpectedCheck: 0 } },
    { ...healthy, source: { ...healthy.source, works: 0, assets: 0 }, target: { ...healthy.target, works: 0, assets: 0 } },
  ])('fails closed on missing, invalid, or unknown reconciliation fields', (input) => {
    expect(() => checkBackendV2(input)).toThrow(/invalid reconciliation input/i);
  });

  it('returns zero for equal aggregates and valid invariants', () => {
    const report = checkBackendV2(healthy);
    expect(report.exitCode).toBe(0);
    expect(report.summary).toEqual({ critical: 0, warning: 0 });
  });

  it('classifies count mismatch and R18/public leakage as critical', () => {
    const report = checkBackendV2({ ...healthy, target: { ...healthy.target, assets: 7 }, invariants: { ...healthy.invariants, publicRestrictedObjects: 1 } });
    expect(report.exitCode).toBe(3);
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining(['COUNT_MISMATCH', 'R18_PUBLIC_OBJECT']));
  });

  it('emits machine-readable and human summaries without identifiers or object keys', () => {
    const report = checkBackendV2(healthy);
    const output = formatCheckReport(report, { json: true });
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain('secret-user');
    expect(output).not.toContain('protected/works');
  });
});
