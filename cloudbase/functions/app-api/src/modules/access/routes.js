'use strict';

function registerAccessRoutes(router, service) {
  router.get('/content/access-policy', () => service.getAgePolicy(), { idempotency: { mode: 'none' } });
  router.put('/me/age-consent', (ctx) => service.acceptAgeConsent(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
  router.delete('/me/age-consent', (ctx) => service.revokeAgeConsent(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
  router.post('/works/{id}/access', (ctx) => service.getWorkAccess(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
}

module.exports = { registerAccessRoutes };
