'use strict';
const READ = { sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } };
const WRITE = { sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' }, rateLimit: [{ bucket: 'admin-console', limit: 60, windowSeconds: 60 }] };
function registerAdminConsoleRoutes(router, service) {
  router.get('/admin/dashboard', (ctx) => service.dashboard(ctx), READ);
  router.get('/admin/moderation/comments', (ctx) => service.listComments(ctx), READ);
  router.get('/admin/moderation/reports', (ctx) => service.listReports(ctx), READ);
  router.get('/admin/users', (ctx) => service.listUsers(ctx), READ);
  router.post('/admin/users/{id}/status', (ctx) => service.setUserStatus(ctx), WRITE);
  router.get('/admin/questions', (ctx) => service.listQuestions(ctx), READ);
  router.post('/admin/questions', (ctx) => service.createQuestion(ctx), WRITE);
  router.patch('/admin/questions/{id}', (ctx) => service.updateQuestion(ctx), WRITE);
  router.post('/admin/questions/{id}/status', (ctx) => service.setQuestionStatus(ctx), WRITE);
  router.get('/admin/jobs', (ctx) => service.listJobs(ctx), READ);
  router.post('/admin/jobs/{id}/retry', (ctx) => service.retryJob(ctx), WRITE);
  router.get('/admin/audit', (ctx) => service.listAudit(ctx), READ);
}
module.exports = { registerAdminConsoleRoutes };
