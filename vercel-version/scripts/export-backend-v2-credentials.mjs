#!/usr/bin/env node
import { privateDecrypt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

function flags(argv) { const result = new Map(); for (const arg of argv) { const [key,...rest] = arg.replace(/^--/,'').split('='); if (!arg.startsWith('--') || !rest.length || result.has(key)) throw new Error('Credential export refused'); result.set(key,rest.join('=')); } return result; }
export function parseCredentialExportArgs(argv) {
  const value=flags(argv); const mode=value.get('mode');
  if (mode==='export' && /^[0-9a-f-]{36}$/i.test(value.get('run-id')||'') && value.get('adapter') && value.get('output') && value.get('ack')==='EXPORT_ENCRYPTED_MIGRATION_CREDENTIALS') return { mode,runId:value.get('run-id'),adapter:value.get('adapter'),output:value.get('output') };
  if (mode==='decrypt' && value.get('input') && value.get('private-key') && value.get('output') && value.get('ack')==='DECRYPT_TO_OFFLINE_SECURE_SINK') return { mode,input:value.get('input'),privateKeyPath:value.get('private-key'),output:value.get('output') };
  throw new Error('Credential export refused');
}
export async function exportEncrypted({ adapter, runId, output }) {
  const envelopes=await adapter.exportCredentialEnvelopes(runId);
  await writeFile(output,`${JSON.stringify({schemaVersion:1,runId,envelopes})}\n`,{encoding:'utf8',flag:'wx',mode:0o600});
  return envelopes.length;
}
export async function decryptOffline({ input, privateKeyPath, output }) {
  const bundle=JSON.parse(await readFile(input,'utf8')); const privateKey=await readFile(privateKeyPath,'utf8');
  if (bundle?.schemaVersion!==1 || !Array.isArray(bundle.envelopes)) throw new Error('Credential export refused');
  const credentials=bundle.envelopes.map((entry) => {
    const value=JSON.parse(privateDecrypt(privateKey,Buffer.from(entry.ciphertext,'base64')).toString('utf8'));
    if (typeof value.legacyId!=='string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value.migrationCredential||'')) throw new Error('Credential export refused');
    return value;
  });
  await writeFile(output,`${JSON.stringify({schemaVersion:1,runId:bundle.runId,credentials})}\n`,{encoding:'utf8',flag:'wx',mode:0o600});
  return credentials.length;
}
async function main() { try { const options=parseCredentialExportArgs(process.argv.slice(2)); let count; if(options.mode==='export'){const module=await import(pathToFileURL(options.adapter).href);const adapter=await module.createMigrationAdapter({environment:process.env.MIGRATION_TARGET_ENVIRONMENT});count=await exportEncrypted({adapter,runId:options.runId,output:options.output});}else count=await decryptOffline(options);process.stdout.write(`credential ${options.mode} completed: count=${count}\n`);}catch{process.stderr.write('Credential export failed; inspect protected operator logs\n');process.exitCode=1;} }
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
