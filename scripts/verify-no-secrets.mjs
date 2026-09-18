import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  '.superpowers',
  '.workbuddy/screenshots',
]);
const IGNORED_FILES = new Set([
  'scripts/verify-no-secrets.mjs',
  'scripts/verify-no-secrets.test.ts',
  'scripts/verify-no-secrets.fixture.ts',
]);
const SOURCE_EXTENSIONS = new Set([
  '.cjs', '.css', '.env', '.html', '.js', '.json', '.mjs', '.py', '.sh', '.sql', '.ts', '.tsx', '.vue', '.yaml', '.yml',
]);

const CREDENTIAL_LITERAL = /\b(?:ADMIN_)?(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY)\b\s*[:=]\s*(['"])([^'"\r\n]+)\1/g;
const PASSWORD_INPUT_LITERAL = /\b(?:fill|type|send_keys)\(\s*['"]#pw['"]\s*,\s*(['"])([^'"\r\n]+)\1/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const TOKEN_LITERAL = /\b(?:Bearer\s+|sk-|gh[pousr]_)[A-Za-z0-9._-]{16,}/g;

function isPlaceholder(value) {
  return /^(?:$|change[-_ ]?me|example|placeholder|your[-_ ]|wrong(?:[-_ ]|$)|definitely[-_ ]?wrong(?:[-_ ]|$)|test(?:[-_ ]|$)|dummy(?:[-_ ]|$)|fake(?:[-_ ]|$)|fixture(?:[-_ ]|$)|process\.env\.|import\.meta\.env\.|undefined|null|true|false)$/i.test(value.trim());
}

export function scanSource(source, path = '<source>') {
  const findings = [];
  const addMatches = (expression, kind) => {
    for (const match of source.matchAll(expression)) {
      const value = match[2] ?? match[0];
      if (kind === 'credential-literal' && isPlaceholder(value)) continue;
      const offset = match.index ?? 0;
      findings.push({
        path,
        line: source.slice(0, offset).split('\n').length,
        kind,
        preview: source.split('\n')[source.slice(0, offset).split('\n').length - 1].trim().slice(0, 180),
      });
    }
  };
  addMatches(CREDENTIAL_LITERAL, 'credential-literal');
  addMatches(PASSWORD_INPUT_LITERAL, 'credential-literal');
  addMatches(PRIVATE_KEY, 'private-key');
  addMatches(TOKEN_LITERAL, 'token-literal');
  return findings;
}

function shouldIgnore(relativePath, directory) {
  if (IGNORED_FILES.has(relativePath)) return true;
  if (relativePath.startsWith('.superpowers/')) return true;
  if (relativePath.startsWith('.workbuddy/screenshots/')) return true;
  if (directory && [...IGNORED_DIRECTORIES].some((ignored) => relativePath === ignored || relativePath.startsWith(`${ignored}/`))) return true;
  return false;
}

function walk(root, current = root) {
  const entries = readdirSync(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = resolve(current, entry.name);
    const relativePath = relative(root, absolutePath).split('\\').join('/');
    if (shouldIgnore(relativePath, entry.isDirectory())) continue;
    if (entry.isDirectory()) files.push(...walk(root, absolutePath));
    else if (SOURCE_EXTENSIONS.has(relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase())) files.push(absolutePath);
  }
  return files;
}

export function scanRepository(root) {
  const findings = [];
  for (const filePath of walk(resolve(root))) {
    let source;
    try {
      source = readFileSync(filePath, 'utf8');
      if (source.includes('\u0000')) continue;
    } catch {
      continue;
    }
    findings.push(...scanSource(source, relative(root, filePath).split('\\').join('/')));
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = scanRepository(resolve(import.meta.dirname, '..'));
  if (findings.length > 0) {
    console.error(`Hard-coded credential patterns found (${findings.length}):`);
    for (const finding of findings) console.error(`- ${finding.path}:${finding.line} [${finding.kind}] ${finding.preview}`);
    process.exitCode = 1;
  } else {
    console.log('No high-confidence hard-coded credentials found.');
  }
}
