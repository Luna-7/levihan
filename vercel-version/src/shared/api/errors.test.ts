import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';

describe('ApiError', () => {
  it('returns the documented top-level error envelope', () => {
    const response = new ApiError(
      429,
      'RATE_LIMITED' as never,
      'Too many requests',
      { retryAfterSeconds: 30 },
      'request-123',
    ).toResponse();

    expect(response).toEqual({
      errorCode: 'RATE_LIMITED',
      message: 'Too many requests',
      requestId: 'request-123',
      details: { retryAfterSeconds: 30 },
    });
  });
});
