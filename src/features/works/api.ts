import { z } from 'zod';

const API_ROOT = '/api/v1';
const Id = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const WorkType = z.enum(['comic', 'novel', 'art', 'resource']);
const Rating = z.enum(['general', 'mature', 'restricted']);
const PublicAsset = z.object({ kind: z.enum(['cover', 'page', 'body', 'attachment', 'preview']), publicPath: z.string().min(1).max(1024), pageNo: z.number().int().positive().optional(), chapterPosition: z.number().int().positive().optional() }).strict();
const PublicChapter = z.object({ title: z.string().min(1).max(200), position: z.number().int().positive() }).strict();
const PublicWork = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/), type: WorkType, title: z.string().min(1).max(120),
  summary: z.string().max(2000), rating: z.enum(['general', 'mature']), authorName: z.string().min(1).max(120),
  publishedAt: Timestamp, chapters: z.array(PublicChapter).max(1000).default([]), assets: z.array(PublicAsset).max(5000),
}).strict();
const Chapter = z.object({ id: Id.nullable(), title: z.string().min(1).max(200), position: z.number().int().positive(), version: z.number().int().positive().nullable() }).strict();
const AdminChapter = z.object({
  id: Id, workId: Id.optional(), title: z.string(), position: z.number().int().positive(), version: z.number().int().positive(),
  status: z.enum(['draft', 'review', 'published', 'archived']), createdAt: Timestamp.optional(), updatedAt: Timestamp.optional(),
}).passthrough();
const AdminAsset = z.object({
  id: Id, workId: Id.optional(), chapterId: Id.nullable().optional(), kind: z.enum(['cover', 'page', 'body', 'attachment', 'preview']),
  objectKey: z.string().min(1), storageZone: z.enum(['public', 'private']), accessLevel: z.enum(['public', 'private']),
  mimeType: z.string(), sizeBytes: z.number().int().nonnegative(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  pageNo: z.number().int().positive().nullable().optional(), status: z.enum(['staging', 'verified', 'active', 'orphaned', 'deleted']),
}).passthrough();
const AdminWork = z.object({
  id: Id, slug: z.string(), type: WorkType, title: z.string(), summary: z.string(), rating: Rating,
  status: z.enum(['draft', 'review', 'published', 'archived', 'deleted']), version: z.number().int().positive(),
  authorName: z.string(), publishedAt: Timestamp.nullable(), createdAt: Timestamp.optional(), updatedAt: Timestamp.optional(),
  chapters: z.array(AdminChapter).optional(), assets: z.array(AdminAsset).optional(),
}).strict();
const AdminWorkResponse = z.object({ work: AdminWork }).strict();
const AdminWorkListResponse = z.object({ items: z.array(AdminWork), nextCursor: z.string().nullable() }).strict();
const UploadTicket = z.object({
  uploadId: Id, fileId: Id, objectKey: z.string().regex(/^staging\/admin\//), method: z.literal('PUT'),
  uploadUrl: z.string().url(), headers: z.record(z.string()), expiresAt: Timestamp,
}).strict();
export type UploadTicket = z.infer<typeof UploadTicket>;
const AssetResponse = z.object({ assetId: Id, status: z.literal('verified') }).strict();
const SnapshotResponse = z.object({ version: z.number().int().positive(), checksum: z.string().regex(/^[a-f0-9]{64}$/), objectKey: z.string().regex(/^snapshots\/public\/catalog\.v\d+\.json$/) }).strict();

export type CreateWorkInput = { slug: string; type: z.infer<typeof WorkType>; title: string; summary: string; rating: z.infer<typeof Rating>; authorName: string };
export type UpdateWorkInput = { version: number; slug?: string; title?: string; summary?: string; rating?: z.infer<typeof Rating>; authorName?: string; chapters?: z.infer<typeof Chapter>[] };
export type InitUploadInput = { workId: string; chapterId?: string; filename: string; mimeType: string; sizeBytes: number; checksum: string; kind: 'cover' | 'page' | 'body' | 'attachment' | 'preview'; pageNo?: number; accessLevel: 'public' | 'private' };

export class WorksApiError extends Error {
  constructor(public readonly errorCode: string, message: string, public readonly requestId?: string) { super(message); this.name = 'WorksApiError'; }
}

function cookie(name: string) {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

async function request(path: string, options: { method?: string; body?: unknown; csrf?: boolean; idempotencyKey?: string } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.csrf) {
    const token = cookie(import.meta.env.VITE_CSRF_COOKIE_NAME || 'lv_csrf');
    if (!token) throw new WorksApiError('ACCESS_DENIED', 'CSRF token is unavailable');
    headers.set('x-csrf-token', token);
  }
  if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);
  const response = await fetch(`${API_ROOT}${path}`, { method: options.method || 'GET', credentials: 'include', headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new WorksApiError(typeof payload?.errorCode === 'string' ? payload.errorCode : 'INTERNAL_ERROR', typeof payload?.message === 'string' ? payload.message : '操作失败，请稍后重试', typeof payload?.requestId === 'string' ? payload.requestId : undefined);
  return payload;
}

const makeIdempotencyKey = () => globalThis.crypto.randomUUID().replaceAll('-', '');
const write = (path: string, body: unknown, method = 'POST', idempotencyKey = makeIdempotencyKey()) => request(path, { method, body, csrf: true, idempotencyKey });

export async function getPublicWork(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug)) throw new WorksApiError('VALIDATION_FAILED', '作品地址无效');
  return z.object({ work: PublicWork }).strict().parse(await request(`/works/${encodeURIComponent(slug)}`));
}
export async function listAdminWorks(options: { status?: 'draft' | 'review' | 'published' | 'archived' | 'deleted'; limit?: number; cursor?: string } = {}) {
  const query = new URLSearchParams();
  if (options.status) query.set('status', options.status);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  return AdminWorkListResponse.parse(await request(`/admin/works${query.size ? `?${query}` : ''}`));
}
export async function getAdminWork(id: string) { Id.parse(id); return AdminWorkResponse.parse(await request(`/admin/works/${id}`)); }
export async function createWork(input: CreateWorkInput) { return AdminWorkResponse.parse(await write('/admin/works', input)); }
export async function updateWork(id: string, input: UpdateWorkInput) { Id.parse(id); return AdminWorkResponse.parse(await write(`/admin/works/${id}`, input, 'PATCH')); }
async function transition(id: string, action: 'review' | 'publish' | 'archive' | 'restore', version: number) { Id.parse(id); return AdminWorkResponse.parse(await write(`/admin/works/${id}/${action}`, { version })); }
export const reviewWork = (id: string, version: number) => transition(id, 'review', version);
export const publishWork = (id: string, version: number) => transition(id, 'publish', version);
export const archiveWork = (id: string, version: number) => transition(id, 'archive', version);
export const restoreWork = (id: string, version: number) => transition(id, 'restore', version);
export async function initAdminUpload(input: InitUploadInput) { return UploadTicket.parse(await write('/admin/uploads/init', input)); }
export async function uploadToCos(ticket: UploadTicket, blob: Blob) {
  const validated = UploadTicket.parse(ticket);
  if (validated.headers['content-type'] !== blob.type) throw new WorksApiError('VALIDATION_FAILED', '文件与上传票据不匹配');
  if (new Date(validated.expiresAt).getTime() <= Date.now()) throw new WorksApiError('STATE_CONFLICT', '上传票据已过期');
  const response = await fetch(validated.uploadUrl, { method: 'PUT', headers: validated.headers, body: blob });
  if (!response.ok) throw new WorksApiError('DEPENDENCY_UNAVAILABLE', '文件上传失败');
}
export async function completeAdminUpload(uploadId: string) { Id.parse(uploadId); return AssetResponse.parse(await write(`/admin/uploads/${uploadId}/complete`, {})); }
export async function rebuildCatalogSnapshot() { return SnapshotResponse.parse(await write('/admin/snapshots/rebuild', {})); }
