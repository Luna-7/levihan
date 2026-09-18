/* eslint-env node */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createSnapshotWorker } = require('../snapshot-worker');

describe('deployed snapshot timer worker', () => {
  it('accepts the Tencent timer shape and invokes the internal processor', async () => {
    const process = vi.fn().mockResolvedValue({ version: 4 });
    const worker = createSnapshotWorker({ buildRuntime: vi.fn().mockReturnValue({ process }) });
    await expect(worker({ Type: 'Timer', TriggerName: 'catalog-snapshot-every-5m', Time: '2030-01-01T00:00:00.000Z', Message: 'catalog' })).resolves.toEqual({ version: 4 });
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ type: 'timer', task: 'catalog-snapshot', scheduledAt: '2030-01-01T00:00:00.000Z' }));
  });

  it('is wired as a private event function with a five-minute trigger', () => {
    const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../cloudbaserc.json'), 'utf8'));
    expect(config.functions).toContainEqual(expect.objectContaining({ name: 'snapshot-worker', type: 'Event', dir: 'app-api', handler: 'snapshot-worker.main', triggers: [expect.objectContaining({ type: 'timer', config: '0 */5 * * * * *' })] }));
  });
});
