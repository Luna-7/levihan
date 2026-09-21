export const normalizeShareLink = (raw: string): string => {
  const s = raw.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/?#].*)?$/i.test(s)) return `https://${s}`;
  const m = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>【】（）《》「」『』，。；！？]+/i.exec(s);
  return m ? m[0] : '';
};

export const fmtTime = (t: string): string => {
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `今天 ${hm}`;
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;
  return `${d.getFullYear()}-${md} ${hm}`;
};
