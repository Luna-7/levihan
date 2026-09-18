'use strict';

const ERROR_CODES = new Set([
  'VALIDATION_FAILED', 'AUTH_REQUIRED', 'SESSION_EXPIRED', 'ACCESS_DENIED', 'AGE_CONSENT_REQUIRED',
  'NOT_FOUND', 'VERSION_CONFLICT', 'STATE_CONFLICT', 'PAYLOAD_TOO_LARGE', 'UPLOAD_NOT_VERIFIED',
  'RATE_LIMITED', 'INTERNAL_ERROR', 'DEPENDENCY_UNAVAILABLE',
]);

class ApiError extends Error {
  constructor(status, errorCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = ERROR_CODES.has(errorCode) ? errorCode : 'INTERNAL_ERROR';
    this.details = details;
  }
}

function errorResponse(error, requestId) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        errorCode: error.errorCode,
        message: error.message,
        requestId,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  return { status: 500, body: { errorCode: 'INTERNAL_ERROR', message: 'Internal server error', requestId } };
}

module.exports = { ApiError, ERROR_CODES, errorResponse };
