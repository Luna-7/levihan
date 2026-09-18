'use strict';

// Do not deploy as an invitation issuer. Keep only the disabled compatibility endpoint.
exports.main = async () => ({
  ok: false,
  errorCode: 'GONE',
  message: 'Invitation registration has been retired',
});
