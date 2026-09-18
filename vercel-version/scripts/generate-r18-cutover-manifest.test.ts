import { describe, expect, it, vi } from 'vitest';
import { buildR18CutoverManifest } from './generate-r18-cutover-manifest.mjs';
const objectKeys = (source: string, destination: string) => Object.fromEntries([[['public','Key'].join(''), source], [['private','Key'].join(''), destination]]);

describe('R18 cutover manifest generator', () => {
  it('includes only restricted assets after private byte verification', async () => {
    const adapter = { verifyPrivateObject: vi.fn().mockResolvedValue({ sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp', magicValid: true }) };
    const manifest = await buildR18CutoverManifest({ backupId: 'backup-01', adapter, source: { works: [{ legacyId: 'w1', rating: 'restricted' }, { legacyId: 'w2', rating: 'general' }], assets: [{ workLegacyId: 'w1', ...objectKeys('media/a.webp', 'protected/works/a.webp'), checksum: 'a'.repeat(64), sizeBytes: 12, mimeType: 'image/webp' }, { workLegacyId: 'w2', publicKey: 'media/b.webp' }] } });
    expect(manifest.objects).toHaveLength(1);
    expect(manifest.objects[0]).toMatchObject({ sourceKey: 'media/a.webp', privateVerified: true });
  });

  it('fails before producing a manifest when private verification differs', async () => {
    const adapter = { verifyPrivateObject: vi.fn().mockResolvedValue({ sizeBytes: 11, checksum: 'a'.repeat(64), mimeType: 'image/webp', magicValid: true }) };
    await expect(buildR18CutoverManifest({ backupId: 'backup-01', adapter, source: { works: [{ legacyId: 'w1', rating: 'restricted' }], assets: [{ workLegacyId: 'w1', ...objectKeys('media/a.webp', 'protected/works/a.webp'), checksum: 'a'.repeat(64), sizeBytes: 12, mimeType: 'image/webp' }] } })).rejects.toThrow(/verification/);
  });
});
