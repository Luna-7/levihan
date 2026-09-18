'use strict';

function registerSnapshotRoutes(router, service) {
  router.get('/snapshots/catalog/current', (ctx) => service.current(ctx), { sessionRequired: false, cacheControl: 'public,max-age=60,must-revalidate', idempotency: 'none' });
  router.post('/admin/snapshots/rebuild', async (ctx) => ({ version: (await service.rebuild(ctx)).version }), { sessionRequired: true, role: 'admin', idempotency: { mode: 'required', responsePolicy: { statuses: [200], body: { version: { type: 'integer' } }, headers: [] } } });
}

module.exports = { registerSnapshotRoutes };
