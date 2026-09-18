import type {
  LoginInput,
  LoginResponse,
  MeResponse,
  RecoveryCodeInput,
  RecoveryCodeResponse,
  RegistrationChallengeResponse,
  RegistrationInput,
  RegistrationResponse,
} from '../../shared/contracts/api';
import {
  LoginInputSchema,
  LoginResponseSchema,
  MeResponseSchema,
  RecoveryCodeInputSchema,
  RecoveryCodeResponseSchema,
  RecoveryConfirmationInputSchema,
  RecoveryConfirmationResponseSchema,
  RegistrationChallengeAnswerInputSchema,
  RegistrationChallengeAnswerResponseSchema,
  RegistrationChallengeResponseSchema,
  RegistrationInputSchema,
  RegistrationResponseSchema,
} from '../../shared/contracts/schemas';

const API_ROOT = '/api/v1';

export class AuthApiError extends Error {
  constructor(public readonly errorCode: string, message: string, public readonly requestId?: string) {
    super(message);
    this.name = 'AuthApiError';
  }
}

function cookie(name: string) {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const item = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

function csrfCookieName() {
  return import.meta.env.VITE_CSRF_COOKIE_NAME || 'lv_csrf';
}

async function request(path: string, { method = 'GET', body, csrf = false }: { method?: string; body?: unknown; csrf?: boolean } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (csrf) {
    const token = cookie(csrfCookieName());
    if (!token) throw new AuthApiError('ACCESS_DENIED', 'CSRF token is unavailable');
    headers.set('x-csrf-token', token);
  }
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    credentials: 'include',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new AuthApiError(
      typeof payload?.errorCode === 'string' ? payload.errorCode : 'INTERNAL_ERROR',
      typeof payload?.message === 'string' ? payload.message : '操作失败，请稍后重试',
      typeof payload?.requestId === 'string' ? payload.requestId : undefined,
    );
  }
  return payload;
}

export async function createRegistrationChallenge(): Promise<RegistrationChallengeResponse> {
  return RegistrationChallengeResponseSchema.parse(await request('/auth/challenges', { method: 'POST', body: {} }));
}

export async function answerRegistrationChallenge(challengeId: string, answer: string) {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new AuthApiError('VALIDATION_FAILED', '答题挑战无效');
  const input = RegistrationChallengeAnswerInputSchema.parse({ answer });
  return RegistrationChallengeAnswerResponseSchema.parse(await request(`/auth/challenges/${encodeURIComponent(challengeId)}/answer`, { method: 'POST', body: input }));
}

export async function register(input: RegistrationInput): Promise<RegistrationResponse> {
  const validated = RegistrationInputSchema.parse(input);
  return RegistrationResponseSchema.parse(await request('/auth/register', { method: 'POST', body: validated }));
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  const validated = LoginInputSchema.parse(input);
  return LoginResponseSchema.parse(await request('/auth/login', { method: 'POST', body: validated }));
}

export async function recover(input: RecoveryCodeInput): Promise<RecoveryCodeResponse> {
  const validated = RecoveryCodeInputSchema.parse(input);
  return RecoveryCodeResponseSchema.parse(await request('/auth/recover', { method: 'POST', body: validated }));
}

export async function confirmRecoveryCode(recoveryCode: string) {
  const input = RecoveryConfirmationInputSchema.parse({ recoveryCode });
  return RecoveryConfirmationResponseSchema.parse(await request('/auth/recovery-confirm', { method: 'POST', body: input, csrf: true }));
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST', body: {}, csrf: true });
}

export async function getMe(): Promise<MeResponse> {
  return MeResponseSchema.parse(await request('/me'));
}
