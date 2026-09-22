// 仅在当前页面内复用已验证的校验码；刷新或关闭页面即清除。
let verifiedCode: string | null = null;

export const getVerifiedComicCode = () => verifiedCode;
export const setVerifiedComicCode = (code: string) => { verifiedCode = code; };
export const clearVerifiedComicCode = () => { verifiedCode = null; };
