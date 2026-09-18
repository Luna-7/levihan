'use strict';

const { parseConfig } = require('./src/config');
const { createApi } = require('./src/http');
const { createLogger } = require('./src/logger');
const { createCloudBaseRateLimitRepository, createCloudBaseActorResolver, createCloudBaseIdempotencyStore } = require('./src/repositories/db');
const { createAuthService } = require('./src/modules/auth/service');
const { registerAuthRoutes } = require('./src/modules/auth/routes');
const { createAuthRepository } = require('./src/modules/auth/repository');
const { createPasswordHasher } = require('./src/modules/auth/passwords');

function createRuntime({ env = process.env, cloudbase, actorResolver, logger, authService } = {}) {
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
  return api;
}

let runtime;
exports.main = async (event) => {
  runtime = runtime || createRuntime();
  return runtime.handle(event);
};
exports.createRuntime = createRuntime;
