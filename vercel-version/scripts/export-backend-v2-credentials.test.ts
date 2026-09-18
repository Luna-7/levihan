import { generateKeyPairSync, publicEncrypt } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it,vi } from 'vitest';
import { decryptOffline,exportEncrypted,parseCredentialExportArgs } from './export-backend-v2-credentials.mjs';

describe('controlled migration credential export',()=>{
  it('requires explicit encrypted export/decrypt acknowledgements',()=>{expect(()=>parseCredentialExportArgs(['--mode=export'])).toThrow(/refused/i);expect(()=>parseCredentialExportArgs(['--mode=decrypt','--input=a','--private-key=b','--output=c'])).toThrow(/refused/i);});
  it('exports encrypted envelopes and decrypts only to exclusive mode-0600 files',async()=>{const directory=await mkdtemp(join(tmpdir(),'levihan-credentials-'));const encrypted=join(directory,'encrypted.json');const keyPath=join(directory,'operator.pem');const output=join(directory,'offline.json');const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const payload={legacyId:'legacy-user-1',migrationCredential:'a'.repeat(43)};const ciphertext=publicEncrypt(publicKey,Buffer.from(JSON.stringify(payload))).toString('base64');const adapter={exportCredentialEnvelopes:vi.fn().mockResolvedValue([{ciphertext}])};await expect(exportEncrypted({adapter,runId:'11111111-1111-4111-8111-111111111111',output:encrypted})).resolves.toBe(1);await writeFile(keyPath,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});await expect(decryptOffline({input:encrypted,privateKeyPath:keyPath,output})).resolves.toBe(1);expect(JSON.parse(await readFile(output,'utf8')).credentials).toEqual([payload]);expect((await stat(output)).mode&0o777).toBe(0o600);await expect(exportEncrypted({adapter,runId:'11111111-1111-4111-8111-111111111111',output:encrypted})).rejects.toThrow();});
});
