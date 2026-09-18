import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubmission, createSubmissionOperationKey, initSubmissionUpload, submitSubmission, uploadSubmissionFile } from './api';

const id = '550e8400-e29b-41d4-a716-446655440001';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('typed submission API', () => {
  it('creates and submits with caller-retained idempotency keys and CSRF', async () => {
    vi.stubGlobal('document', { cookie: `lv_csrf=${'c'.repeat(43)}` });
    const item = { id, type: 'novel', title: '春', summary: '', status: 'draft', version: 1, assetCount: 0, payload: { description: '说明', rating: 'mature' }, assets: [], acceptedWorkId: null };
    const fetchMock = vi.fn().mockResolvedValueOnce(response(item)).mockResolvedValueOnce(response({ ...item, status: 'submitted', version: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const key = createSubmissionOperationKey();
    await createSubmission({ type: 'novel', title: '春', summary: '', description: '说明', rating: 'mature' }, key);
    await submitSubmission(id, 1, key);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/submissions', `/api/v1/submissions/${id}/submit`]);
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init.headers).get('idempotency-key')).toBe(key);
  });

  it('keeps the signed POST policy in memory and reports real XHR upload progress', async () => {
    vi.stubGlobal('document', { cookie: `lv_csrf=${'c'.repeat(43)}` });
    const ticket = { uploadId: id, fileId: id, objectKey: `staging/submissions/${id}/${id}/${id}/${id}.webp`, method: 'POST', uploadUrl: 'https://private.cos.test/', fields: { key: 'staging/key', policy: 'signed-policy' }, expiresAt: '2030-01-01T00:05:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValueOnce(response(ticket));
    vi.stubGlobal('fetch', fetchMock);
    let sent: FormData | undefined;
    class FakeXHR {
      status = 204; upload: { onprogress?: (event: ProgressEvent) => void } = {}; onerror?: (event: ProgressEvent) => void; ontimeout?: (event: ProgressEvent) => void; onload?: () => void;
      open(method: string, url: string) { expect([method, url]).toEqual(['POST', ticket.uploadUrl]); }
      send(body: FormData) { sent = body; this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 3 } as ProgressEvent); this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const value = await initSubmissionUpload(id, { submissionType: 'comic', filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 3, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1 }, createSubmissionOperationKey());
    const file = new File(['abc'], 'page.webp', { type: 'image/webp' });
    const progress: number[] = []; await uploadSubmissionFile(value, file, (amount) => progress.push(amount));
    expect(progress).toEqual([0, 67, 100]); expect(sent?.get('policy')).toBe('signed-policy'); expect(sent?.get('file')).toBe(file);
  });
});
