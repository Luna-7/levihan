import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TEXT_FILE_BYTES = 2_000_000;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.vite']);
const IGNORED_FILES = new Set(['scripts/verify-no-secrets.fixture.ts']);
const BINARY_EXTENSIONS = new Set([
  '.7z', '.avi', '.bmp', '.class', '.dll', '.gif', '.ico', '.jar', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.otf',
  '.pdf', '.png', '.so', '.tar', '.tif', '.tiff', '.ttf', '.wav', '.webp', '.woff', '.woff2', '.zip',
]);

const CREDENTIAL_LITERAL = /(?:^|[^A-Za-z0-9_$])["'` ]?(?:admin[_-]?password|adminPassword|password|passwd|secret[_-]?key|secretKey|secret|(?:[A-Za-z][A-Za-z0-9]*[_-])api[_-]?key|api[_-]?key|apiKey|access[_-]?key[_-]?id|accessKeyId|aws_access_key_id|aws_secret_access_key|private[_-]?key|privateKey|token)["'` ]?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`)/gi;
const CREDENTIAL_UNQUOTED = /(?:^|[^A-Za-z0-9_$])["'` ]?(?:admin[_-]?password|adminPassword|password|passwd|secret[_-]?key|secretKey|secret|api[_-]?key|apiKey|(?:[A-Za-z][A-Za-z0-9]*[_-])api[_-]?key|access[_-]?key[_-]?id|accessKeyId|aws_access_key_id|aws_secret_access_key|private[_-]?key|privateKey|token)["'` ]?\s*[:=]\s*(?!["'`])([^\s#;,]+)/gi;
const PASSWORD_INPUT_LITERAL = /\b(?:fill|type|send_keys)\(\s*["'`]#pw["'`]\s*,\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`)/gi;
const PRIVATE_KEY_MARKER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g;
const AWS_ACCESS_KEY_ID = /\bAKIA[0-9A-Z]{16}\b/g;
const TOKEN_SHAPED = /\b(?:Bearer\s+[A-Za-z0-9._~:-]{16,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_-]{16,})/g;
const GITHUB_TOKEN = /\bgithub_pat_[A-Za-z0-9_-]{16,}/g;

function isPlaceholder(value) {
  const normalized = value.trim();
  return normalized === ''
    || normalized.includes('${')
    || /^\{\{[^}]+\}\}$/.test(normalized)
    || /^(?:process\.env(?:\.[A-Z0-9_]+|\[[^\]]+\])?|import\.meta\.env(?:\.[A-Z0-9_]+|\[[^\]]+\])?)$/i.test(normalized)
    || /^(?:\d+\.(?:forged|whatever)|change[-_ ]?me|example|placeholder|your[-_ ]|wrong(?:[-_ ]|$)|definitely[-_ ]?wrong(?:[-_ ]|$)|forged(?:[-_ ]|$)|whatever(?:[-_ ]|$)|test(?:[-_ ]|$)|dummy(?:[-_ ]|$)|fake(?:[-_ ]|$)|fixture(?:[-_ ]|$)|a[-_ ](?:new[-_ ]?)?secure[-_ ]password|must[-_ ]never[-_ ]be[-_ ]in[-_ ]json)/i.test(normalized);
}

function finding(path, source, offset, ruleId) {
  return {
    path,
    line: source.slice(0, offset).split('\n').length,
    ruleId,
    kind: ruleId,
  };
}

function addMatches(findings, source, path, expression, ruleId, valueIndexes = []) {
  for (const match of source.matchAll(expression)) {
    const value = valueIndexes.map((index) => match[index]).find((candidate) => candidate !== undefined);
    if (value !== undefined && isPlaceholder(value)) continue;
    findings.push(finding(path, source, match.index ?? 0, ruleId));
  }
}

function isEnvironmentStyleFile(path) {
  const basename = path.split('/').pop()?.toLowerCase() ?? '';
  return basename === 'dockerfile'
    || basename.startsWith('.env')
    || basename.endsWith('.env')
    || /\.(?:conf|ini|toml|yaml|yml)$/i.test(basename);
}

export function scanSource(source, path = '<source>') {
  const findings = [];
  addMatches(findings, source, path, CREDENTIAL_LITERAL, 'credential-literal', [1, 2, 3]);
  if (isEnvironmentStyleFile(path)) addMatches(findings, source, path, CREDENTIAL_UNQUOTED, 'credential-literal', [1]);
  addMatches(findings, source, path, PASSWORD_INPUT_LITERAL, 'credential-literal', [1, 2, 3]);
  addMatches(findings, source, path, PRIVATE_KEY_MARKER, 'private-key-marker');
  addMatches(findings, source, path, AWS_ACCESS_KEY_ID, 'aws-access-key-id');
  addMatches(findings, source, path, GITHUB_TOKEN, 'github-token');
  addMatches(findings, source, path, TOKEN_SHAPED, 'token-shaped');
  return findings;
}

function shouldIgnore(relativePath, isDirectory) {
  if (IGNORED_FILES.has(relativePath)) return true;
  if (isDirectory && relativePath.split('/').some((segment) => IGNORED_DIRECTORIES.has(segment))) return true;
  if (/^\.superpowers\/sdd\/.+\/review-[^/]*\.diff$/i.test(relativePath)) return true;
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
    else files.push(absolutePath);
  }
  return files;
}

function isBinary(filePath, source) {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.has(extension) || source.includes(0);
}

export function scanRepository(root) {
  const repositoryRoot = resolve(root);
  const findings = [];
  for (const filePath of walk(repositoryRoot)) {
    let sourceBuffer;
    try {
      sourceBuffer = readFileSync(filePath);
    } catch {
      continue;
    }
    if (sourceBuffer.length > MAX_TEXT_FILE_BYTES || isBinary(filePath, sourceBuffer)) continue;
    findings.push(...scanSource(sourceBuffer.toString('utf8'), relative(repositoryRoot, filePath).split('\\').join('/')));
  }
  return findings;
}

export function formatFindings(findings) {
  return findings.map(({ path, line, ruleId }) => `${path}:${line} ${ruleId} [REDACTED]`).join('\n') + (findings.length ? '\n' : '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, '..');
  try {
    const findings = scanRepository(root);
    if (findings.length > 0) {
      process.stderr.write(formatFindings(findings));
      process.exitCode = 1;
    } else {
      process.stdout.write('No high-confidence hard-coded credentials found.\n');
    }
  } catch {
    process.stderr.write('[REDACTED]\n');
    process.exitCode = 1;
  }
}
