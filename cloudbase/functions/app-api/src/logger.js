'use strict';

const crypto = require('crypto');

function createLogger({ write = console.log, actorPepper }) {
  function record(entry) {
    const safe = {
      requestId: entry.requestId,
      method: entry.method,
      route: entry.route,
      status: entry.status,
      durationMs: entry.durationMs,
      environment: entry.environment,
      timestamp: entry.timestamp,
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
      ...(entry.errorType ? { errorType: entry.errorType } : {}),
      ...(entry.actorId ? { actorIdHash: crypto.createHmac('sha256', actorPepper).update(String(entry.actorId)).digest('hex') } : {}),
    };
    write(safe);
  }
  return { info: record, error: record };
}

module.exports = { createLogger };
