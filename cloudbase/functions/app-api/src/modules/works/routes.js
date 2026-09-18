'use strict';

const ADMIN = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } });

function registerWorksRoutes(router, service) {
  router.get('/works/{slug}', (ctx) => service.getPublic(ctx), { idempotency: { mode: 'none' } });
  router.get('/admin/works', (ctx) => service.listAdmin(ctx), ADMIN);
  router.post('/admin/works', (ctx) => service.create(ctx), ADMIN);
  router.get('/admin/works/{id}', (ctx) => service.getAdmin(ctx), ADMIN);
  router.patch('/admin/works/{id}', (ctx) => service.update(ctx), ADMIN);
  router.post('/admin/works/{id}/review', (ctx) => service.transition(ctx, 'review'), ADMIN);
  router.post('/admin/works/{id}/publish', (ctx) => service.transition(ctx, 'publish'), ADMIN);
  router.post('/admin/works/{id}/archive', (ctx) => service.transition(ctx, 'archive'), ADMIN);
  router.post('/admin/works/{id}/restore', (ctx) => service.transition(ctx, 'restore'), ADMIN);
}

module.exports = { registerWorksRoutes };
