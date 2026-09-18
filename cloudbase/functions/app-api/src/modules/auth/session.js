'use strict';

const crypto = require('crypto');

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function domainHash(pepper, domain, value) {
  if (typeof pepper !== 'string' || pepper.length < 32) throw new Error('Authentication hash pepper must be at least 32 characters');
  return crypto.createHmac('sha256', pepper).update(`${domain}\0${String(value)}`).digest('hex');
}

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateRecoveryCode() {
  const bytes = crypto.randomBytes(16);
  const raw = [...bytes].map((value) => RECOVERY_ALPHABET[value % RECOVERY_ALPHABET.length]).join('');
  return raw.match(/.{4}/g).join('-');
}

function constantTimeIncludes(values, candidate) {
  const expected = Buffer.from(candidate);
  let matched = 0;
  for (const value of Array.isArray(values) ? values : []) {
    const actual = Buffer.from(typeof value === 'string' ? value : '');
    const comparable = actual.length === expected.length ? actual : Buffer.alloc(expected.length);
    matched |= Number(crypto.timingSafeEqual(expected, comparable) && actual.length === expected.length);
  }
  return matched === 1;
}

module.exports = { domainHash, generateOpaqueToken, generateRecoveryCode, constantTimeIncludes };
