import { describe, expect, it } from 'vitest';
import { validateCosConfiguration } from './verify-cos-backend-v2.mjs';

const cors = { origins: ['https://levihan.example'], methods: ['GET','POST','PUT'], headers: ['Content-Type','x-cos-meta-sha256'] };
const safe = { privatePublicGrant: false, publicBucketPublicGrant: false, privateWebsiteEnabled: false, publicWebsiteEnabled: false, privateCors: cors, publicCors: cors, stagingLifecycle: { prefix: 'staging/', expirationDays: 1 }, publicPolicy: { allowedGetObjectPrefixes: ['media/works/*', 'snapshots/public/*'], anonymousActions: ['name/cos:GetObject'], anonymousResources: ['media/works/*', 'snapshots/public/*'], anonymousDenyCount: 0, conditionalAllowCount: 0 } };
describe('COS configuration read-back verifier', () => {
  it('accepts exact dual-bucket controls', () => expect(validateCosConfiguration(safe, ['https://levihan.example'])).toEqual([]));
  it('fails bucket grants, wildcard CORS, website, missing PUT/checksum, or lifecycle closed', () => expect(validateCosConfiguration({ ...safe, privatePublicGrant: true, publicBucketPublicGrant: true, privateWebsiteEnabled: true, publicCors: { origins: ['*'], methods: ['GET'], headers: ['Content-Type'] }, stagingLifecycle: null }, ['https://levihan.example']).length).toBeGreaterThanOrEqual(6));
  it('requires an exact anonymous read-only policy for only the two public prefixes', () => {
    expect(validateCosConfiguration({ ...safe, publicPolicy: null }, ['https://levihan.example'])).toContain('public bucket policy is not least privilege');
    expect(validateCosConfiguration({ ...safe, publicPolicy: { allowedGetObjectPrefixes: ['*'], anonymousActions: ['name/cos:GetObject','name/cos:GetBucket'], anonymousResources: ['*'] } }, ['https://levihan.example'])).toContain('public bucket policy is not least privilege');
    expect(validateCosConfiguration({ ...safe, publicPolicy: { ...safe.publicPolicy, anonymousDenyCount: 1 } }, ['https://levihan.example'])).toContain('public bucket policy is not least privilege');
  });
});
