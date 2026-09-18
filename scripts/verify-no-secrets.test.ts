import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository, scanSource } from './verify-no-secrets.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

describe('hard-coded secret scanner', () => {
  it('detects high-confidence credential literals in source text', () => {
    const findings = scanSource('const ADMIN_PASSWORD = "fixture-secret-value";\n', 'fixture.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('credential-literal');
  });

  it('does not scan its own explicit fixture', () => {
    const fixturePath = resolve(repositoryRoot, 'scripts/verify-no-secrets.fixture.ts');
    expect(existsSync(fixturePath)).toBe(true);
    expect(scanRepository(repositoryRoot).some((finding) => finding.path.endsWith('verify-no-secrets.fixture.ts'))).toBe(false);
  });

  it('passes only when tracked/worktree source contains no hard-coded credentials', () => {
    const findings = scanRepository(repositoryRoot);
    expect(findings, findings.map((finding) => `${finding.path}:${finding.line} ${finding.preview}`).join('\n')).toEqual([]);
  });
});
