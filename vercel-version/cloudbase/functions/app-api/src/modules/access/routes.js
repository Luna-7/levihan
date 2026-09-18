'use strict';

function registerAccessRoutes(router, service) {
  router.get('/content/access-policy', () => service.getAgePolicy(), { idempotency: { mode: 'none' } });
  router.put('/me/age-consent', (ctx) => service.acceptAgeConsent(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
  router.delete('/me/age-consent', (ctx) => service.revokeAgeConsent(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
  router.post('/works/{id}/access', (ctx) => service.getWorkAccess(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
  const adminControl = { sessionRequired: true, role: 'admin', idempotency: { mode: 'required', responsePolicy: { statuses: [200], body: { id: { type: 'uuid' }, status: { enum: ['blocked', 'allowed'] } }, headers: [] } } };
  router.post('/admin/users/{id}/restricted-access/revoke', (ctx) => service.setRestrictedAccess(ctx, 'revoke'), adminControl);
  router.post('/admin/users/{id}/restricted-access/restore', (ctx) => service.setRestrictedAccess(ctx, 'restore'), adminControl);
}

module.exports = { registerAccessRoutes };
