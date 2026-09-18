'use strict';

// Legacy verification is intentionally disabled; no code or caller data is inspected.
exports.main = async () => ({
  ok: false,
  errorCode: 'GONE',
  message: 'Invitation registration has been retired',
});
