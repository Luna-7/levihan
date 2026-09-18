'use strict';

const { parseConfig } = require('./src/config');
const { createApi } = require('./src/http');
const { createLogger } = require('./src/logger');
const { createCloudBaseRateLimitRepository, createCloudBaseActorResolver, createCloudBaseIdempotencyStore } = require('./src/repositories/db');
const { createAuthService } = require('./src/modules/auth/service');
const { registerAuthRoutes } = require('./src/modules/auth/routes');
const { createAuthRepository } = require('./src/modules/auth/repository');
const { createPasswordHasher } = require('./src/modules/auth/passwords');
const { createWorksService } = require('./src/modules/works/service');
const { createWorksRepository } = require('./src/modules/works/repository');
const { registerWorksRoutes } = require('./src/modules/works/routes');
const { createUploadsService } = require('./src/modules/uploads/service');
const { createUploadsRepository } = require('./src/modules/uploads/repository');
const { registerUploadRoutes } = require('./src/modules/uploads/routes');
const { createSnapshotService, createSnapshotHttpService } = require('./src/modules/snapshots/service');
const { createSnapshotRepository } = require('./src/modules/snapshots/repository');
const { registerSnapshotRoutes } = require('./src/modules/snapshots/routes');
const { createRuntimeCosObjectStore } = require('./src/infrastructure/cos');
const { createAccessService } = require('./src/modules/access/service');
const { createAccessRepository } = require('./src/modules/access/repository');
const { registerAccessRoutes } = require('./src/modules/access/routes');
const { createInteractionsService } = require('./src/modules/interactions/service');
const { createInteractionsRepository } = require('./src/modules/interactions/repository');
const { registerInteractionRoutes } = require('./src/modules/interactions/routes');
const { createSubmissionsService } = require('./src/modules/submissions/service');
const { createSubmissionsRepository } = require('./src/modules/submissions/repository');
const { registerSubmissionRoutes } = require('./src/modules/submissions/routes');

function createRuntime({ env = process.env, cloudbase, actorResolver, logger, authService, worksService, uploadsService, snapshotService, accessService, interactionsService, submissionsService, objectStore } = {}) {
  const config = parseConfig(env);
  const sdk = cloudbase || require('@cloudbase/node-sdk');
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV, accessKey: config.cloudbaseApiKey });
  const rdb = app.rdb({ database: config.databaseSchema });
  const rateLimiter = createCloudBaseRateLimitRepository({ rdb });
  const runtimeLogger = logger || createLogger({ actorPepper: config.sessionHashPepper });
  const runtimeActorResolver = actorResolver || createCloudBaseActorResolver({ rdb, config });
  const idempotencyStore = createCloudBaseIdempotencyStore({ rdb, reportSecurityEvent: (event) => runtimeLogger.error(event) });
  const api = createApi({ config, rateLimiter, idempotencyStore, actorResolver: runtimeActorResolver, logger: runtimeLogger });
  registerAuthRoutes(api.router, authService || createAuthService({
    repository: createAuthRepository({ rdb }),
    passwordHasher: createPasswordHasher(),
    pepper: config.authHashPepper,
  }));
  const runtimeObjectStore = objectStore || createRuntimeCosObjectStore({ config, env });
  registerWorksRoutes(api.router, worksService || createWorksService({ repository: createWorksRepository({ rdb }) }));
  registerUploadRoutes(api.router, uploadsService || createUploadsService({ repository: createUploadsRepository({ rdb }), objectStore: runtimeObjectStore }));
  registerSnapshotRoutes(api.router, snapshotService || createSnapshotHttpService(createSnapshotService({ repository: createSnapshotRepository({ rdb }), objectStore: runtimeObjectStore })));
  registerAccessRoutes(api.router, accessService || createAccessService({ repository: createAccessRepository({ rdb }), objectStore: runtimeObjectStore }));
  registerInteractionRoutes(api.router, interactionsService || createInteractionsService({ repository: createInteractionsRepository({ rdb }) }));
  registerSubmissionRoutes(api.router, submissionsService || createSubmissionsService({ repository: createSubmissionsRepository({ rdb }), objectStore: runtimeObjectStore }));
  return api;
}

let runtime;
exports.main = async (event) => {
  runtime = runtime || createRuntime();
  return runtime.handle(event);
};
exports.createRuntime = createRuntime;
