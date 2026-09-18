'use strict';

const crypto = require('crypto');

const RATE_LIMIT_POLICIES = {
  '/auth/challenges': [{ bucket: 'registration-challenge-ip', limit: 10, windowSeconds: 60 }],
  '/auth/challenges/{id}/answer': [{ bucket: 'registration-answer-ip', limit: 20, windowSeconds: 600 }],
  '/auth/register': [{ bucket: 'registration-ip', limit: 3, windowSeconds: 3600 }],
  '/auth/login': [{ bucket: 'login-ip', limit: 10, windowSeconds: 900 }, { bucket: 'login-username', limit: 10, windowSeconds: 900, subject: 'username' }],
  '/auth/recover': [{ bucket: 'recover-ip', limit: 5, windowSeconds: 3600 }],
  '/works/{id}/comments': [{ bucket: 'comment-ip', limit: 10, windowSeconds: 60 }],
  '/submissions': [{ bucket: 'submission-ip', limit: 5, windowSeconds: 3600 }],
  '/works/{id}/access': [{ bucket: 'signed-url-ip', limit: 30, windowSeconds: 60 }],
};

function hashSubject(value, pepper) {
  return crypto.createHmac('sha256', pepper).update(String(value || 'unknown')).digest('hex');
}

function defaultRateLimitForRoute(method, routePath) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? RATE_LIMIT_POLICIES[routePath] : undefined;
}

module.exports = { RATE_LIMIT_POLICIES, hashSubject, defaultRateLimitForRoute };
