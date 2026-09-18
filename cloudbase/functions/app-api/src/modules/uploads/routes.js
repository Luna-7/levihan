'use strict';

const ADMIN = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' } });

function registerUploadRoutes(router, service) {
  router.post('/admin/uploads/init', (ctx) => service.initAdmin(ctx), ADMIN);
  router.post('/admin/uploads/{id}/complete', (ctx) => service.completeAdmin(ctx), ADMIN);
}

module.exports = { registerUploadRoutes };
