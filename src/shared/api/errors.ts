import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'ACCESS_DENIED',
  'AGE_CONSENT_REQUIRED',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'STATE_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UPLOAD_NOT_VERIFIED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'DEPENDENCY_UNAVAILABLE',
]);

export const ApiErrorResponseSchema = z.object({
  errorCode: ApiErrorCodeSchema,
  message: z.string().min(1),
  requestId: z.string().min(1).max(128),
  details: z.record(z.unknown()).optional(),
}).strict();

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Record<string, unknown> | undefined,
    public readonly requestId: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toResponse(): ApiErrorResponse {
    return ApiErrorResponseSchema.parse({
      errorCode: this.code,
      message: this.message,
      requestId: this.requestId,
      ...(this.details === undefined ? {} : { details: this.details }),
    });
  }
}
