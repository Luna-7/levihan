'use strict';

// Retained for one backup window so deployments referencing the old function
// fail closed without reading or mutating the legacy invite collection.
exports.main = async () => ({
  ok: false,
  errorCode: 'GONE',
  message: 'Invitation registration has been retired',
});
