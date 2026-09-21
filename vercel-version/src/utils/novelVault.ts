import * as CryptoJsNamespace from 'crypto-js';

/**
 * 文稿保险箱（novels_vault）解密：与敏感漫画本同一套密码链。
 * 云函数 novelDirectPublish 加密：key = SHA-256('levihan') 32 字节 raw，
 * IV = 'levihan-vault-iv'（16 字节 ASCII），AES-256-CBC → Base64。
 * 任何一端改参数都会解不开历史密文。
 */
const CryptoJS = ((CryptoJsNamespace as unknown as { default?: typeof CryptoJsNamespace }).default ??
  CryptoJsNamespace) as unknown as typeof CryptoJsNamespace;

const VAULT_PASSWORD = 'levihan';
const VAULT_IV_UTF8 = 'levihan-vault-iv';

/** 密文 Base64 文本 → 明文正文。解出空串视为失败（密钥不匹配/密文损坏）。 */
export function decryptNovelBody(cipherBase64: string): string {
  const key = CryptoJS.SHA256(VAULT_PASSWORD);
  const iv = CryptoJS.enc.Utf8.parse(VAULT_IV_UTF8);
  const params = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(cipherBase64.trim()),
  });
  const bytes = CryptoJS.AES.decrypt(params, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return bytes.toString(CryptoJS.enc.Utf8);
}
