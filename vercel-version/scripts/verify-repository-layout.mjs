import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyRepositoryLayout(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const required = [
    '.openai/hosting.json',
    'vercel-version/package.json',
    'vercel-version/admin.html',
    'vercel-version/api/v1/[...path].ts',
    'vercel-version/cloudbase/cloudbaserc.json',
    'vercel-version/cloudbase/functions/app-api/index.js',
  ];
  const forbidden = [
    'package.json', 'admin.html', 'api/v1/[...path].ts', 'cloudbase/cloudbaserc.json',
    'cloudbase/functions/app-api/index.js', 'cloudfunctions',
    'vercel-version/cloudbase/functions/registerWithPassword',
    'vercel-version/cloudbase/functions/loginWithPassword',
    'vercel-version/cloudbase/migrations/20260918030000_nickname_password_auth.sql',
    'vercel-version/cloudbase/migrations/20260918040000_users_nickname_key.sql',
  ];
  const findings = [];
  for (const path of required) if (!existsSync(resolve(root, path))) findings.push(`missing:${path}`);
  for (const path of forbidden) if (existsSync(resolve(root, path))) findings.push(`duplicate:${path}`);
  if (findings.length) return findings;

  const manifest = JSON.parse(readFileSync(resolve(root, 'vercel-version/cloudbase/cloudbaserc.json'), 'utf8'));
  const names = manifest.functions.map((entry) => entry.name).sort();
  const expected = ['app-api', 'snapshot-worker', 'upload-cleanup-worker'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) findings.push('cloudbase:function-set');
  const hosting = JSON.parse(readFileSync(resolve(root, '.openai/hosting.json'), 'utf8'));
  if (hosting.static?.directory !== 'vercel-version/dist') findings.push('hosting:output-directory');
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = verifyRepositoryLayout(resolve(import.meta.dirname, '../..'));
  if (findings.length) {
    process.stderr.write(`${findings.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Repository deploy layout is single-source.\n');
  }
}
