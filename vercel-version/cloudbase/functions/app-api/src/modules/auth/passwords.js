'use strict';

const argon2 = require('@node-rs/argon2');

const ARGON2ID_OPTIONS = Object.freeze({
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

function createPasswordHasher(adapter = argon2) {
  return {
    hash(password) { return adapter.hash(password, ARGON2ID_OPTIONS); },
    verify(passwordHash, password) { return adapter.verify(passwordHash, password); },
  };
}

module.exports = { ARGON2ID_OPTIONS, createPasswordHasher };
