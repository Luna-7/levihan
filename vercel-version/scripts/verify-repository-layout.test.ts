import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { verifyRepositoryLayout } from './verify-repository-layout.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('repository deploy layout', () => {
  it('has exactly one deployable frontend/API/CloudBase source', () => {
    expect(verifyRepositoryLayout(repositoryRoot)).toEqual([]);
  });

  it('rejects a second root CloudBase source', () => {
    const root = mkdtempSync(join(tmpdir(), 'levihan-layout-'));
    for (const path of [
      'vercel-version/api/v1',
      'vercel-version/cloudbase/functions/app-api',
      '.openai',
      'cloudfunctions',
    ]) mkdirSync(resolve(root, path), { recursive: true });
    writeFileSync(resolve(root, 'vercel-version/package.json'), '{}');
    writeFileSync(resolve(root, 'vercel-version/admin.html'), '');
    writeFileSync(resolve(root, 'vercel-version/api/v1/[...path].ts'), '');
    writeFileSync(resolve(root, 'vercel-version/cloudbase/functions/app-api/index.js'), '');
    writeFileSync(resolve(root, 'vercel-version/cloudbase/cloudbaserc.json'), JSON.stringify({ functions: [
      { name: 'app-api' }, { name: 'snapshot-worker' }, { name: 'upload-cleanup-worker' },
    ] }));
    writeFileSync(resolve(root, '.openai/hosting.json'), JSON.stringify({ static: { directory: 'vercel-version/dist' } }));
    try {
      expect(verifyRepositoryLayout(root)).toContain('duplicate:cloudfunctions');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects legacy password auth in active function or migration roots', () => {
    expect(verifyRepositoryLayout(repositoryRoot)).toEqual([]);
    const activeFunction = resolve(repositoryRoot, 'vercel-version/cloudbase/functions/registerWithPassword');
    mkdirSync(activeFunction, { recursive: true });
    try {
      expect(verifyRepositoryLayout(repositoryRoot)).toContain('duplicate:vercel-version/cloudbase/functions/registerWithPassword');
    } finally {
      rmSync(activeFunction, { recursive: true, force: true });
    }
  });
});
