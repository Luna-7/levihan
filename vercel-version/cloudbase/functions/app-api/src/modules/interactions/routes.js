'use strict';

const safeRequired = (body) => ({ sessionRequired: true, idempotency: { mode: 'required', responsePolicy: { statuses: [200], body, headers: [] } } });
const reactionWrite = { sessionRequired: true, idempotency: { mode: 'none' } };
const commentWrite = { ...safeRequired({ id: { type: 'uuid' }, status: { enum: ['pending', 'published'] }, createdAt: { type: 'iso-date' } }), rateLimit: [{ bucket: 'comment-ip', limit: 10, windowSeconds: 60 }] };
const deletedWrite = safeRequired({ id: { type: 'uuid' }, status: { enum: ['deleted'] } });
const commentAdmin = { ...safeRequired({ id: { type: 'uuid' }, status: { enum: ['hidden', 'published'] } }), role: 'admin' };
const reportWrite = safeRequired({ id: { type: 'uuid' }, status: { enum: ['pending', 'reviewing'] }, duplicate: { type: 'boolean' } });
const reportAdmin = { ...safeRequired({ id: { type: 'uuid' }, status: { enum: ['reviewing', 'resolved', 'rejected'] } }), role: 'admin' };

function registerInteractionRoutes(router, service) {
  for (const type of ['like', 'favorite']) {
    router.put(`/works/{id}/${type}`, (ctx) => service.setReaction(ctx, type, true), reactionWrite);
    router.delete(`/works/{id}/${type}`, (ctx) => service.setReaction(ctx, type, false), reactionWrite);
  }
  router.get('/works/{id}/comments', (ctx) => service.listComments(ctx), { idempotency: { mode: 'none' } });
  router.post('/works/{id}/comments', (ctx) => service.createComment(ctx), commentWrite);
  router.delete('/comments/{id}', (ctx) => service.deleteComment(ctx), deletedWrite);
  router.post('/admin/comments/{id}/hide', (ctx) => service.moderateComment(ctx, 'hide'), commentAdmin);
  router.post('/admin/comments/{id}/restore', (ctx) => service.moderateComment(ctx, 'restore'), commentAdmin);
  router.get('/works/{id}/progress', (ctx) => service.getProgress(ctx), { sessionRequired: true, idempotency: { mode: 'none' } });
  router.put('/works/{id}/progress', (ctx) => service.putProgress(ctx), { sessionRequired: true, idempotency: { mode: 'domain' } });
  router.post('/reports', (ctx) => service.createReport(ctx), reportWrite);
  router.post('/admin/reports/{id}', (ctx) => service.moderateReport(ctx), reportAdmin);
}

module.exports = { registerInteractionRoutes };
