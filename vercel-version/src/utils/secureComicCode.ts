// 仅在当前页面内存中复用已验证的校验码，30 分钟后失效。
const VERIFIED_CODE_TTL_MS = 30 * 60 * 1000;
let verifiedCode: string | null = null;
let expiresAt = 0;

export const getVerifiedComicCode = () => {
  if (!verifiedCode || Date.now() >= expiresAt) {
    clearVerifiedComicCode();
    return null;
  }
  return verifiedCode;
};

export const setVerifiedComicCode = (code: string) => {
  verifiedCode = code;
  expiresAt = Date.now() + VERIFIED_CODE_TTL_MS;
};

export const clearVerifiedComicCode = () => {
  verifiedCode = null;
  expiresAt = 0;
};
