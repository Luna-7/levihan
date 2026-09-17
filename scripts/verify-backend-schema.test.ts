import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const migrationPath = resolve(repositoryRoot, 'cloudbase/migrations/20260918_backend_v2.sql');
const verifierPath = resolve(repositoryRoot, 'scripts/verify-backend-schema.mjs');

describe('backend v2 PostgreSQL migration', () => {
  it('statically validates the additive schema, security controls, and atomic routines', () => {
    expect(existsSync(migrationPath), 'the v2 additive migration must exist').toBe(true);
    expect(existsSync(verifierPath), 'the schema verifier must exist').toBe(true);

    const verification = spawnSync(process.execPath, [verifierPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(verification.status, verification.stderr || verification.stdout).toBe(0);
    expect(verification.stdout).toContain('backend v2 schema static verification passed');
  });
});
