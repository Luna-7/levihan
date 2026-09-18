'use strict';

const ADMIN_READ = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } });
const ADMIN_WRITE = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' } });

function registerWorksRoutes(router, service) {
  router.get('/works/{slug}', (ctx) => service.getPublic(ctx), { idempotency: { mode: 'none' } });
  router.get('/admin/works', (ctx) => service.listAdmin(ctx), ADMIN_READ);
  router.post('/admin/works', (ctx) => service.create(ctx), ADMIN_WRITE);
  router.get('/admin/works/{id}', (ctx) => service.getAdmin(ctx), ADMIN_READ);
  router.patch('/admin/works/{id}', (ctx) => service.update(ctx), ADMIN_WRITE);
  router.post('/admin/works/{id}/review', (ctx) => service.transition(ctx, 'review'), ADMIN_WRITE);
  router.post('/admin/works/{id}/publish', (ctx) => service.transition(ctx, 'publish'), ADMIN_WRITE);
  router.post('/admin/works/{id}/archive', (ctx) => service.transition(ctx, 'archive'), ADMIN_WRITE);
  router.post('/admin/works/{id}/restore', (ctx) => service.transition(ctx, 'restore'), ADMIN_WRITE);
}

module.exports = { registerWorksRoutes };
