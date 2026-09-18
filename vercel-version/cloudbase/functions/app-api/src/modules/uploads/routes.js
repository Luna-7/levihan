'use strict';

const ADMIN_DOMAIN = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' } });
const ADMIN_COMPLETE = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'required', responsePolicy: { statuses: [200], body: { assetId: { type: 'uuid' }, status: { enum: ['verified'] } }, headers: [] } } });

function registerUploadRoutes(router, service) {
  router.post('/admin/uploads/init', (ctx) => service.initAdmin(ctx), ADMIN_DOMAIN);
  router.post('/admin/uploads/{id}/complete', (ctx) => service.completeAdmin(ctx), ADMIN_COMPLETE);
}

module.exports = { registerUploadRoutes };
