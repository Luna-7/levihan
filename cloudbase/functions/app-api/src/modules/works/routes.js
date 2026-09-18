'use strict';

const ADMIN_READ = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } });
const ADMIN_WRITE = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'required', responsePolicy: {
  statuses: [200], body: { id: { type: 'uuid' }, status: { enum: ['draft', 'review', 'published', 'archived'] }, version: { type: 'integer' } }, headers: [],
} } });
const mutation = (operation) => async (ctx) => { const result = await operation(ctx); return { id: result.work.id, status: result.work.status, version: result.work.version }; };

function registerWorksRoutes(router, service) {
  router.get('/works/{slug}', (ctx) => service.getPublic(ctx), { idempotency: { mode: 'none' } });
  router.get('/admin/works', (ctx) => service.listAdmin(ctx), ADMIN_READ);
  router.post('/admin/works', mutation((ctx) => service.create(ctx)), ADMIN_WRITE);
  router.get('/admin/works/{id}', (ctx) => service.getAdmin(ctx), ADMIN_READ);
  router.patch('/admin/works/{id}', mutation((ctx) => service.update(ctx)), ADMIN_WRITE);
  router.post('/admin/works/{id}/review', mutation((ctx) => service.transition(ctx, 'review')), ADMIN_WRITE);
  router.post('/admin/works/{id}/publish', mutation((ctx) => service.transition(ctx, 'publish')), ADMIN_WRITE);
  router.post('/admin/works/{id}/archive', mutation((ctx) => service.transition(ctx, 'archive')), ADMIN_WRITE);
  router.post('/admin/works/{id}/restore', mutation((ctx) => service.transition(ctx, 'restore')), ADMIN_WRITE);
}

module.exports = { registerWorksRoutes };
