'use strict';

const { parseConfig } = require('./src/config');
const { createUploadsService } = require('./src/modules/uploads/service');
const { createUploadsRepository } = require('./src/modules/uploads/repository');
const { createRuntimeCosObjectStore } = require('./src/infrastructure/cos');

function buildUploadCleanupWorkerRuntime({ env = process.env, cloudbase, objectStore, uploadsService } = {}) {
  const config = parseConfig(env);
  if (!config.snapshotSystemActorId) throw new Error('Upload cleanup system actor is required');
  const sdk = cloudbase || require('@cloudbase/node-sdk');
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV, accessKey: config.cloudbaseApiKey });
  const rdb = app.rdb({ database: config.databaseSchema });
  const store = objectStore || createRuntimeCosObjectStore({ config, env });
  const service = uploadsService || createUploadsService({ repository: createUploadsRepository({ rdb }), objectStore: store });
  return { process: (event) => service.cleanupStalePromotions({ actorId: config.snapshotSystemActorId, actorRole: 'admin', requestId: `cleanup:${event.scheduledAt}` }, 20) };
}

function createUploadCleanupWorker({ buildRuntime = buildUploadCleanupWorkerRuntime } = {}) {
  let runtime;
  return async function uploadCleanupWorker(event) {
    if (!event || event.Type !== 'Timer' || typeof event.TriggerName !== 'string' || typeof event.Message !== 'string' || Number.isNaN(Date.parse(event.Time))) throw new Error('Invalid Tencent timer event');
    runtime = runtime || buildRuntime();
    return runtime.process({ type: 'timer', task: 'upload-cleanup', scheduledAt: new Date(event.Time).toISOString(), triggerName: event.TriggerName, message: event.Message });
  };
}

exports.createUploadCleanupWorker = createUploadCleanupWorker;
exports.buildUploadCleanupWorkerRuntime = buildUploadCleanupWorkerRuntime;
exports.main = createUploadCleanupWorker();
