import { z } from 'zod';

const API_ROOT = '/api/v1';
const Id = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const Status = z.enum(['draft', 'submitted', 'under_review', 'accepted', 'rejected', 'withdrawn']);
const Submission = z.object({
  id: Id, type: z.enum(['comic', 'novel', 'recommendation', 'other']), title: z.string().min(1).max(120), summary: z.string().max(2000),
  status: Status, version: z.number().int().positive(), assetCount: z.number().int().nonnegative(), rejectionReason: z.string().max(500).optional(),
  payload: z.object({ description: z.string().max(10000), rating: z.enum(['general', 'mature', 'restricted']) }).strict(),
  assets: z.array(z.object({ fileId: Id, kind: z.enum(['cover', 'page', 'body', 'attachment']), pageNo: z.number().int().positive().nullable(), status: z.string(), mimeType: z.string(), sizeBytes: z.number().int().nonnegative().nullable() }).strict()),
  acceptedWorkId: Id.nullable(), createdAt: Timestamp.optional(), updatedAt: Timestamp.optional(),
}).strict();
const List = z.object({ items: z.array(Submission), nextCursor: z.string().nullable() }).strict();
const UploadTicket = z.object({ uploadId: Id, fileId: Id, objectKey: z.string().regex(/^staging\/submissions\//), method: z.literal('POST'), uploadUrl: z.string().url(), fields: z.record(z.string()), expiresAt: Timestamp }).strict();
const UploadInit = z.union([UploadTicket, z.object({ uploadId: Id, fileId: Id, status: z.enum(['processing', 'verified']) }).strict()]);
const UploadComplete = z.object({ fileId: Id, status: z.literal('verified') }).strict();

export type Submission = z.infer<typeof Submission>;
export type SubmissionType = Submission['type'];
export type UploadTicket = z.infer<typeof UploadTicket>;
export type DraftInput = { type: SubmissionType; title: string; summary: string; description: string; rating: 'general' | 'mature' | 'restricted' };
export type UploadInput = { submissionType: SubmissionType; filename: string; mimeType: string; sizeBytes: number; checksum: string; kind: 'cover' | 'page' | 'body' | 'attachment'; pageNo?: number };

export class SubmissionApiError extends Error {
  constructor(public readonly errorCode: string, message: string, public readonly requestId?: string) { super(message); this.name = 'SubmissionApiError'; }
}

function cookie(name: string) { if (typeof document === 'undefined') return ''; const prefix = `${name}=`; const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix)); return item ? decodeURIComponent(item.slice(prefix.length)) : ''; }
function operationKey(value: string) { if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new SubmissionApiError('VALIDATION_FAILED', '操作编号无效'); return value; }
async function request(path: string, options: { method?: string; body?: unknown; key?: string } = {}) {
  const headers = new Headers(); if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.method && options.method !== 'GET') { const csrf = cookie(import.meta.env.VITE_CSRF_COOKIE_NAME || 'lv_csrf'); if (!csrf) throw new SubmissionApiError('ACCESS_DENIED', 'CSRF token is unavailable'); headers.set('x-csrf-token', csrf); headers.set('idempotency-key', operationKey(options.key || '')); }
  const response = await fetch(`${API_ROOT}${path}`, { method: options.method || 'GET', credentials: 'include', headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new SubmissionApiError(typeof payload?.errorCode === 'string' ? payload.errorCode : 'INTERNAL_ERROR', typeof payload?.message === 'string' ? payload.message : '操作失败，请稍后重试', typeof payload?.requestId === 'string' ? payload.requestId : undefined);
  return payload;
}

export const createSubmissionOperationKey = () => globalThis.crypto.randomUUID().replaceAll('-', '');
export async function listMySubmissions(cursor?: string) { const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''; return List.parse(await request(`/submissions${query}`)); }
export async function getMySubmission(id: string) { Id.parse(id); return Submission.parse(await request(`/submissions/${id}`)); }
export async function createSubmission(input: DraftInput, key: string) { return Submission.parse(await request('/submissions', { method: 'POST', body: input, key })); }
export async function updateSubmission(id: string, input: Omit<Partial<DraftInput>, 'type'> & { version: number }, key: string) { Id.parse(id); return Submission.parse(await request(`/submissions/${id}`, { method: 'PATCH', body: input, key })); }
async function transition(id: string, action: 'submit' | 'withdraw', version: number, key: string) { Id.parse(id); return Submission.parse(await request(`/submissions/${id}/${action}`, { method: 'POST', body: { version }, key })); }
export const submitSubmission = (id: string, version: number, key: string) => transition(id, 'submit', version, key);
export const withdrawSubmission = (id: string, version: number, key: string) => transition(id, 'withdraw', version, key);
export async function initSubmissionUpload(id: string, input: UploadInput, key: string) { Id.parse(id); return UploadInit.parse(await request(`/submissions/${id}/uploads/init`, { method: 'POST', body: input, key })); }
export async function uploadSubmissionFile(ticket: UploadTicket, file: File, onProgress: (percent: number) => void) {
  const value = UploadTicket.parse(ticket); if (new Date(value.expiresAt).getTime() <= Date.now()) throw new SubmissionApiError('STATE_CONFLICT', '上传票据已过期，请重新获取'); if (file.size <= 0) throw new SubmissionApiError('VALIDATION_FAILED', '文件为空');
  const body = new FormData(); for (const [name, field] of Object.entries(value.fields)) body.append(name, field); body.append('file', file);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', value.uploadUrl); xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded * 100 / event.total))); }; xhr.onerror = () => reject(new SubmissionApiError('DEPENDENCY_UNAVAILABLE', '素材上传失败，可使用同一操作编号重试')); xhr.ontimeout = xhr.onerror; xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(); } else xhr.onerror?.(new ProgressEvent('error')); }; onProgress(0); xhr.send(body);
  });
}
export async function completeSubmissionUpload(submissionId: string, uploadId: string, key: string) { Id.parse(submissionId); Id.parse(uploadId); return UploadComplete.parse(await request(`/submissions/${submissionId}/uploads/${uploadId}/complete`, { method: 'POST', body: {}, key })); }
export async function sha256File(file: File) { const bytes = await file.arrayBuffer(); const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
