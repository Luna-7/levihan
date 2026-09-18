import { describe, expect, it } from 'vitest';
import { isRestrictedRequest } from './cache-policy';
import { readFileSync } from 'node:fs';

describe('restricted content service-worker policy', () => {
  it('explicitly keeps access responses, protected paths, and signed COS queries network-only', () => {
    expect(isRestrictedRequest({ url: new URL('https://levihan.test/api/v1/works/abc/access') })).toBe(true);
    expect(isRestrictedRequest({ url: new URL('https://private.cos.test/protected/works/a/p.webp') })).toBe(true);
    expect(isRestrictedRequest({ url: new URL('https://private.cos.test/any?p=1&q-sign-algorithm=sha1') })).toBe(true);
    expect(isRestrictedRequest({ url: new URL('https://public.cos.test/media/works/a/preview.webp') })).toBe(false);
    const config = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/urlPattern:\s*\/\^\\\/api\\\/v1\\\/works[\s\S]*?handler:\s*'NetworkOnly'[\s\S]*?method:\s*'POST'/);
  });
});
