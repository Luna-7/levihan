import { z } from 'zod';

const API_ROOT = '/api/v1';
const Id = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const Consent = z.object({ policyVersion: z.string().min(1).max(64), acceptedAt: Timestamp }).strict();
const Asset = z.object({
  id: Id, kind: z.enum(['cover', 'page', 'body', 'attachment', 'preview']), mimeType: z.string().min(1).max(255),
  pageNo: z.number().int().positive().optional(), chapterPosition: z.number().int().positive().optional(),
  url: z.string().url().refine((value) => new URL(value).protocol === 'https:'), expiresAt: Timestamp,
}).strict();
const RestrictedAccess = z.object({
  work: z.object({ id: Id, type: z.enum(['comic', 'novel', 'art', 'resource']), title: z.string().min(1).max(120), rating: z.enum(['general', 'mature', 'restricted']) }).strict(),
  assets: z.array(Asset).max(5000),
}).strict();
const AgePolicy = z.object({ policyVersion: z.string().min(1).max(64), warning: z.string().min(1).max(2000), assurance: z.literal('self_declaration_only') }).strict();

export type RestrictedAccessResponse = z.infer<typeof RestrictedAccess>;

export class AccessApiError extends Error {
  constructor(public readonly errorCode: string, message: string, public readonly requestId?: string) { super(message); this.name = 'AccessApiError'; }
}

function cookie(name: string) {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

async function write(path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown) {
  const csrf = cookie(import.meta.env.VITE_CSRF_COOKIE_NAME || 'lv_csrf');
  if (!csrf) throw new AccessApiError('ACCESS_DENIED', 'CSRF token is unavailable');
  const headers = new Headers({ 'content-type': 'application/json', 'x-csrf-token': csrf });
  const response = await fetch(`${API_ROOT}${path}`, { method, credentials: 'include', headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new AccessApiError(typeof payload?.errorCode === 'string' ? payload.errorCode : 'INTERNAL_ERROR', typeof payload?.message === 'string' ? payload.message : '操作失败，请稍后重试', typeof payload?.requestId === 'string' ? payload.requestId : undefined);
  return payload;
}

async function read(path: string) {
  const response = await fetch(`${API_ROOT}${path}`, { method: 'GET', credentials: 'include', headers: new Headers() });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new AccessApiError(typeof payload?.errorCode === 'string' ? payload.errorCode : 'INTERNAL_ERROR', typeof payload?.message === 'string' ? payload.message : '操作失败，请稍后重试', typeof payload?.requestId === 'string' ? payload.requestId : undefined);
  return payload;
}

export async function getAgePolicy() { return AgePolicy.parse(await read('/content/access-policy')); }

export async function acceptAgeConsent(policyVersion: string) {
  return Consent.parse(await write('/me/age-consent', 'PUT', { isAdult: true, policyVersion }));
}

export async function revokeAgeConsent() {
  return z.object({ revoked: z.boolean() }).strict().parse(await write('/me/age-consent', 'DELETE', {}));
}

export async function getRestrictedAccess(workId: string): Promise<RestrictedAccessResponse> {
  Id.parse(workId);
  return RestrictedAccess.parse(await write(`/works/${encodeURIComponent(workId)}/access`, 'POST', {}));
}
