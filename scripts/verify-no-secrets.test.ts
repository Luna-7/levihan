import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { scanRepository, scanSource } from './verify-no-secrets.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

describe('hard-coded secret scanner', () => {
  it('detects high-confidence credential literals in source text', () => {
    const canary = ['canary', 'credential', '9f3e'].join('-');
    const snakeKey = ['ADMIN', 'PASSWORD'].join('_');
    const findings = scanSource(['const ', snakeKey, ' = `', canary, '`;\n'].join(''), 'fixture.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('credential-literal');
    expect(findings[0].kind).toBe('credential-literal');
  });

  it('recognizes camelCase, colon, backtick, and AWS credential keys', () => {
    const canary = ['canary', 'matrix', '2a'].join('-');
    const lines = [
      ['adminPassword', ': "', canary, '"'].join(''),
      ['apiKey', '= `', canary, '`'].join(''),
      ['secretKey', ': `', canary, '`'].join(''),
      ['accessKeyId', '= "', canary, '"'].join(''),
      ['aws_access_key_id', ': "', ['AK', 'IA', '1234567890ABCDEF'].join(''), '"'].join(''),
      ['aws_secret_access_key', '= `', canary, '`'].join(''),
    ];
    const findings = scanSource(lines.join('\n'), 'fixture.conf');
    expect(findings.filter((finding) => finding.ruleId === 'credential-literal')).toHaveLength(6);
  });

  it('recognizes private-key markers and token-shaped credentials', () => {
    const privateMarker = ['-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'].join('');
    const accessKeyId = ['AK', 'IA', '1234567890ABCDEF'].join('');
    const bearer = ['Bearer ', 'canaryTokenValue123456789'].join('');
    const findings = scanSource([privateMarker, accessKeyId, bearer].join('\n'), 'fixture.md');
    expect(findings.map((finding) => finding.ruleId)).toEqual([
      'private-key-marker',
      'aws-access-key-id',
      'token-shaped',
    ]);
  });

  it('allows environment references, empty values, templates, and obvious placeholders', () => {
    const key = ['admin', 'Password'].join('');
    const values = [
      ['process.env.', 'ADMIN_TEST_PASSWORD'].join(''),
      ['${', 'ADMIN_TEST_PASSWORD}'].join(''),
      '',
      'example-secret',
      'change-me-now',
      'your-secret-here',
    ];
    const findings = scanSource(values.map((value) => [key, '= "', value, '"'].join('')).join('\n'), 'fixture.ini');
    expect(findings).toEqual([]);
  });

  it('redacts canary values in CLI errors and only emits path, line, rule, and marker', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'secret-scanner-'));
    const candidate = join(temporaryDirectory, 'credentials.md');
    const canary = ['canary', 'stderr', '4c2'].join('-');
    const key = ['admin', 'Password'].join('');
    writeFileSync(candidate, [key, ': "', canary, '"\n'].join(''));

    try {
      const verification = spawnSync(process.execPath, [resolve(repositoryRoot, 'scripts/verify-no-secrets.mjs'), temporaryDirectory], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });
      const output = `${verification.stdout}${verification.stderr}`;
      expect(verification.status).not.toBe(0);
      expect(output).toBe('credentials.md:1 credential-literal [REDACTED]\n');
      expect(output).not.toContain(canary);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('does not scan its own explicit fixture', () => {
    const fixturePath = resolve(repositoryRoot, 'scripts/verify-no-secrets.fixture.ts');
    expect(existsSync(fixturePath)).toBe(true);
    expect(scanRepository(repositoryRoot).some((finding) => finding.path.endsWith('verify-no-secrets.fixture.ts'))).toBe(false);
  });

  it('passes only when tracked/worktree source contains no hard-coded credentials', () => {
    const findings = scanRepository(repositoryRoot);
    expect(findings, findings.map((finding) => `${finding.path}:${finding.line} ${finding.ruleId} [REDACTED]`).join('\n')).toEqual([]);
  });
});
