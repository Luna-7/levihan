'use strict';

function registerSnapshotRoutes(router, service) {
  router.post('/admin/snapshots/rebuild', (ctx) => service.rebuild(ctx), { sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } });
}

module.exports = { registerSnapshotRoutes };
