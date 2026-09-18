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
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
      ...(entry.actorId ? { actorIdHash: crypto.createHmac('sha256', actorPepper).update(String(entry.actorId)).digest('hex') } : {}),
    };
    write(safe);
  }
  return { info: record, error: record };
}

module.exports = { createLogger };
