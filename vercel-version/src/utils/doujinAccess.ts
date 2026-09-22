export const DOUJIN_SESSION_KEY = 'doujin_manga_unlocked_v2';

export function clearDoujinSessionUnlock(): void {
  try {
    window.sessionStorage.removeItem(DOUJIN_SESSION_KEY);
  } catch {
    // 受限浏览器中 sessionStorage 可能不可用。
  }
}
