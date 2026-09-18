'use strict';

function registerAuthRoutes(router, service) {
  const anonymousWrite = { csrfExempt: true, idempotency: { mode: 'none' } };
  const sessionWrite = { sessionRequired: true, idempotency: { mode: 'none' } };

  router.post('/auth/challenges', (ctx) => service.createChallenge(ctx), anonymousWrite);
  router.post('/auth/challenges/{id}/answer', (ctx) => service.answerChallenge(ctx), anonymousWrite);
  router.post('/auth/register', (ctx) => service.register(ctx), {
    ...anonymousWrite,
    rateLimit: [{ bucket: 'registration-attempt-ip', limit: 5, windowSeconds: 60 }],
  });
  router.post('/auth/login', (ctx) => service.login(ctx), anonymousWrite);
  router.post('/auth/logout', (ctx) => service.logout(ctx), sessionWrite);
  router.post('/auth/recover', (ctx) => service.recover(ctx), anonymousWrite);
  router.post('/auth/recovery-confirm', (ctx) => service.confirmRecovery(ctx), { idempotency: { mode: 'none' } });
  router.post('/auth/recovery-regenerate', (ctx) => service.regenerateRecovery(ctx), {
    idempotency: { mode: 'none' }, rateLimit: [{ bucket: 'recovery-regenerate-ip', limit: 3, windowSeconds: 3600 }],
  });
  router.get('/me', (ctx) => service.me(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
}

module.exports = { registerAuthRoutes };
