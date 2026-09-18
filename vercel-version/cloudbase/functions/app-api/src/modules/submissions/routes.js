'use strict';

const USER_READ = Object.freeze({ sessionRequired: true, idempotency: { mode: 'none' } });
const USER_WRITE = Object.freeze({ sessionRequired: true, idempotency: { mode: 'domain' }, rateLimit: [{ bucket: 'submission-user-write', limit: 30, windowSeconds: 60 }] });
const SUBMIT_WRITE = Object.freeze({ sessionRequired: true, idempotency: { mode: 'domain' }, rateLimit: [{ bucket: 'submission-user-submit', limit: 6, windowSeconds: 3600 }] });
const COMPLETE_WRITE = Object.freeze({ sessionRequired: true, idempotency: { mode: 'domain' }, rateLimit: [{ bucket: 'submission-upload-complete', limit: 30, windowSeconds: 60 }] });
const ADMIN_READ = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } });
const ADMIN_WRITE = Object.freeze({ sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' }, rateLimit: [{ bucket: 'submission-admin-review', limit: 60, windowSeconds: 60 }] });

function registerSubmissionRoutes(router, service) {
  router.get('/submissions', (ctx) => service.listMine(ctx), USER_READ);
  router.get('/submissions/{id}', (ctx) => service.getMine(ctx), USER_READ);
  router.post('/submissions', (ctx) => service.createDraft(ctx), USER_WRITE);
  router.patch('/submissions/{id}', (ctx) => service.updateDraft(ctx), USER_WRITE);
  router.post('/submissions/{id}/submit', (ctx) => service.submit(ctx), SUBMIT_WRITE);
  router.post('/submissions/{id}/withdraw', (ctx) => service.withdraw(ctx), USER_WRITE);
  router.post('/submissions/{id}/uploads/init', (ctx) => service.initUpload(ctx), USER_WRITE);
  router.post('/submissions/{id}/uploads/{uploadId}/complete', (ctx) => service.completeUpload(ctx), COMPLETE_WRITE);
  router.get('/admin/submissions', (ctx) => service.listAdmin(ctx), ADMIN_READ);
  router.patch('/admin/submissions/{id}', (ctx) => service.review(ctx), ADMIN_WRITE);
}

module.exports = { registerSubmissionRoutes };
