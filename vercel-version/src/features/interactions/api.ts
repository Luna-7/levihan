import { z } from 'zod';

const API_ROOT = '/api/v1';
const Id = z.string().uuid();
const WorkRef = z.union([Id, z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/)]);
const Timestamp = z.string().datetime({ offset: true });
const Position = z.union([
  z.object({ kind: z.literal('comic'), page: z.number().int().min(1).max(100000) }).strict(),
  z.object({ kind: z.literal('novel'), chapter: z.number().int().min(1).max(100000), offset: z.number().int().min(0).max(10000000) }).strict(),
]);
const Comment = z.object({ id: Id, authorName: z.string().min(1).max(64), body: z.string().min(1).max(500), createdAt: Timestamp }).strict();
const CommentCursor = z.string().regex(/^\d{4}-\d\d-\d\dT[^|]+\|[0-9a-f-]{36}$/i);
const CommentList = z.object({ items: z.array(Comment).max(50), count: z.number().int().nonnegative(), nextCursor: CommentCursor.nullable() }).strict();
const CommentCreated = z.object({ id: Id, status: z.enum(['pending', 'published']), createdAt: Timestamp }).strict();
const Reaction = z.object({ active: z.boolean(), count: z.number().int().nonnegative() }).strict();
const Progress = z.object({ position: Position, percent: z.number().min(0).max(100), logicVersion: z.number().int().positive(), clientVersion: z.number().int().positive(), mutationId: Id, version: z.number().int().positive(), updatedAt: Timestamp }).strict();
const ProgressResult = Progress.extend({ accepted: z.boolean() }).strict();
const ProgressEnvelope = z.object({ progress: Progress.nullable() }).strict();
const Report = z.object({ id: Id, status: z.enum(['pending', 'reviewing']), duplicate: z.boolean() }).strict();

export type ReadingPosition = z.infer<typeof Position>;
export type ReadingProgress = z.infer<typeof Progress>;
export type CommentItem = z.infer<typeof Comment>;
export type ProgressMutation = { position: ReadingPosition; percent: number; logicVersion: number; clientVersion: number; baseVersion: number; mutationId: string };

export class InteractionApiError extends Error {
  constructor(public readonly errorCode: string, message: string, public readonly requestId?: string) { super(message); this.name = 'InteractionApiError'; }
}

function cookie(name: string) {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : '';
}

async function request(path: string, options: { method?: string; body?: unknown; write?: boolean; idempotencyKey?: string } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.write) {
    const token = cookie(import.meta.env.VITE_CSRF_COOKIE_NAME || 'lv_csrf');
    if (!token) throw new InteractionApiError('ACCESS_DENIED', 'CSRF token is unavailable');
    headers.set('x-csrf-token', token);
  }
  if (options.idempotencyKey) { Id.parse(options.idempotencyKey); headers.set('idempotency-key', options.idempotencyKey); }
  const response = await fetch(`${API_ROOT}${path}`, { method: options.method || 'GET', credentials: 'include', headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new InteractionApiError(typeof payload?.errorCode === 'string' ? payload.errorCode : 'INTERNAL_ERROR', typeof payload?.message === 'string' ? payload.message : '操作失败，请稍后重试', typeof payload?.requestId === 'string' ? payload.requestId : undefined);
  return payload;
}

const workPath = (workRef: string) => encodeURIComponent(WorkRef.parse(workRef));
export async function listComments(workRef: string, limit = 20, cursor?: string) {
  const query = new URLSearchParams({ limit: String(limit) }); if (cursor) query.set('cursor', CommentCursor.parse(cursor));
  return CommentList.parse(await request(`/works/${workPath(workRef)}/comments?${query}`));
}
export async function createComment(workRef: string, body: string, mutationId: string, parentId?: string) {
  return CommentCreated.parse(await request(`/works/${workPath(workRef)}/comments`, { method: 'POST', write: true, idempotencyKey: mutationId, body: { body, ...(parentId ? { parentId: Id.parse(parentId) } : {}) } }));
}
export async function setReaction(workRef: string, type: 'like' | 'favorite', active: boolean) {
  return Reaction.parse(await request(`/works/${workPath(workRef)}/${type}`, { method: active ? 'PUT' : 'DELETE', write: true, body: {} }));
}
export async function getReadingProgress(workRef: string) { return ProgressEnvelope.parse(await request(`/works/${workPath(workRef)}/progress`)).progress; }
export async function syncReadingProgress(workRef: string, mutation: ProgressMutation) {
  Id.parse(mutation.mutationId); Position.parse(mutation.position); z.number().int().nonnegative().parse(mutation.baseVersion);
  return ProgressResult.parse(await request(`/works/${workPath(workRef)}/progress`, { method: 'PUT', write: true, idempotencyKey: mutation.mutationId, body: mutation }));
}
export async function createReport(input: { targetType: 'work' | 'comment'; targetId: string; reason: 'illegal' | 'copyright' | 'harassment' | 'spam' | 'other'; note?: string }, mutationId: string) {
  return Report.parse(await request('/reports', { method: 'POST', write: true, idempotencyKey: mutationId, body: { ...input, targetId: Id.parse(input.targetId) } }));
}
