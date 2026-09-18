'use strict';

function registerSnapshotRoutes(router, service) {
  router.post('/admin/snapshots/rebuild', async (ctx) => ({ version: (await service.rebuild(ctx)).version }), { sessionRequired: true, role: 'admin', idempotency: { mode: 'required', responsePolicy: { statuses: [200], body: { version: { type: 'integer' } }, headers: [] } } });
}

module.exports = { registerSnapshotRoutes };
