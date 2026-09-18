'use strict';

const { parseConfig } = require('./src/config');
const { createSnapshotService, createSnapshotTimerHandler } = require('./src/modules/snapshots/service');
const { createSnapshotRepository } = require('./src/modules/snapshots/repository');
const { createRuntimeCosObjectStore } = require('./src/infrastructure/cos');

function buildSnapshotWorkerRuntime({ env = process.env, cloudbase, objectStore } = {}) {
  const config = parseConfig(env);
  const sdk = cloudbase || require('@cloudbase/node-sdk');
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV, accessKey: config.cloudbaseApiKey });
  const rdb = app.rdb({ database: config.databaseSchema });
  const store = objectStore || createRuntimeCosObjectStore({ config, env });
  const service = createSnapshotService({ repository: createSnapshotRepository({ rdb }), objectStore: store });
  return { process: createSnapshotTimerHandler({ service, actorId: config.snapshotSystemActorId }) };
}

function createSnapshotWorker({ buildRuntime = buildSnapshotWorkerRuntime } = {}) {
  let runtime;
  return async function snapshotWorker(event) {
    if (!event || event.Type !== 'Timer' || typeof event.TriggerName !== 'string' || typeof event.Message !== 'string' || Number.isNaN(Date.parse(event.Time))) throw new Error('Invalid Tencent timer event');
    runtime = runtime || buildRuntime();
    return runtime.process({ type: 'timer', task: 'catalog-snapshot', scheduledAt: new Date(event.Time).toISOString(), triggerName: event.TriggerName, message: event.Message });
  };
}

exports.createSnapshotWorker = createSnapshotWorker;
exports.buildSnapshotWorkerRuntime = buildSnapshotWorkerRuntime;
exports.main = createSnapshotWorker();
