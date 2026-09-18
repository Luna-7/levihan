/* eslint-env node */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createUploadCleanupWorker, buildUploadCleanupWorkerRuntime } = require('../upload-cleanup-worker');

describe('deployed upload cleanup timer worker', () => {
  const env = { NODE_ENV: 'test', CLOUDBASE_APIKEY: 'test-key', DATABASE_SCHEMA: 'test', COS_PUBLIC_BUCKET: 'public-1', COS_PRIVATE_BUCKET: 'private-1', COS_REGION: 'ap-test', SNAPSHOT_SYSTEM_ACTOR_ID: '550e8400-e29b-41d4-a716-446655440001', SESSION_HASH_PEPPER: 'a'.repeat(32), AUTH_HASH_PEPPER: 'b'.repeat(32), RATE_LIMIT_PEPPER: 'c'.repeat(32), API_ALLOWED_ORIGINS: 'https://example.test' };

  it('accepts Tencent Timer events and invokes only cleanup', async () => {
    const cleanupStalePromotions = vi.fn().mockResolvedValue({ claimed: 2 });
    const runtime = buildUploadCleanupWorkerRuntime({ env, uploadsService: { cleanupStalePromotions } });
    const worker = createUploadCleanupWorker({ buildRuntime: vi.fn().mockReturnValue(runtime) });
    await expect(worker({ Type: 'Timer', TriggerName: 'upload-cleanup-every-10m', Time: '2030-01-01T00:00:00.000Z', Message: 'cleanup' })).resolves.toEqual({ claimed: 2 });
    expect(cleanupStalePromotions).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'admin' }), 20);
  });

  it('is wired as an independent private Event function', () => {
    const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../cloudbaserc.json'), 'utf8'));
    expect(config.functions).toContainEqual(expect.objectContaining({ name: 'upload-cleanup-worker', type: 'Event', dir: 'app-api', handler: 'upload-cleanup-worker.main', triggers: [expect.objectContaining({ type: 'timer', config: '0 */10 * * * * *' })] }));
  });
});
