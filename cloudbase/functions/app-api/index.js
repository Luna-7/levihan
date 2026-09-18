'use strict';

const { parseConfig } = require('./src/config');
const { createApi } = require('./src/http');
const { createLogger } = require('./src/logger');
const { createCloudBaseRateLimitRepository, createCloudBaseIdempotencyStore } = require('./src/repositories/db');

function createRuntime({ env = process.env, cloudbase } = {}) {
  const config = parseConfig(env);
  const sdk = cloudbase || require('@cloudbase/node-sdk');
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV, accessKey: config.cloudbaseApiKey });
  const rdb = app.rdb({ database: config.databaseSchema });
  const rateLimiter = createCloudBaseRateLimitRepository({ rdb });
  return createApi({ config, rateLimiter, idempotencyStore: createCloudBaseIdempotencyStore({ rdb }), logger: createLogger({ actorPepper: config.sessionHashPepper }) });
}

let runtime;
exports.main = async (event) => {
  runtime = runtime || createRuntime();
  return runtime.handle(event);
};
exports.createRuntime = createRuntime;
