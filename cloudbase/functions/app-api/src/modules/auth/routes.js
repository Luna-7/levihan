'use strict';

function registerAuthRoutes(router, service) {
  const anonymousWrite = { csrfExempt: true, idempotency: { mode: 'none' } };
  const sessionWrite = { sessionRequired: true, idempotency: { mode: 'none' } };

  router.post('/auth/challenges', (ctx) => service.createChallenge(ctx), anonymousWrite);
  router.post('/auth/challenges/{id}/answer', (ctx) => service.answerChallenge(ctx), anonymousWrite);
  router.post('/auth/register', (ctx) => service.register(ctx), { ...anonymousWrite, rateLimit: false });
  router.post('/auth/login', (ctx) => service.login(ctx), anonymousWrite);
  router.post('/auth/logout', (ctx) => service.logout(ctx), sessionWrite);
  router.post('/auth/recover', (ctx) => service.recover(ctx), anonymousWrite);
  router.post('/auth/recovery-confirm', (ctx) => service.confirmRecovery(ctx), { idempotency: { mode: 'none' } });
  router.get('/me', (ctx) => service.me(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
}

module.exports = { registerAuthRoutes };
