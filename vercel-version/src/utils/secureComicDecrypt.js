// 与管理台的 SHA-256(password) + AES-256-CBC + 固定 IV 格式兼容。
// 浏览器原生 Web Crypto 在后台执行 AES，避免 crypto-js 在主线程逐块解密。
const IV = new TextEncoder().encode('levihan-vault-iv');

export async function decryptOuterLayer(cipherTextBase64, password) {
  const binary = atob(cipherTextBase64);
  const cipherBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) cipherBytes[i] = binary.charCodeAt(i);

  const passwordBytes = new TextEncoder().encode(password);
  const keyBytes = await crypto.subtle.digest('SHA-256', passwordBytes);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: IV }, key, cipherBytes);
  return new Uint8Array(plain);
}
