/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('retired invitation functions', () => {
  it.each(['consumeInviteCode', 'generateInviteCode', 'validateRegistrationInvite', 'verifyInviteCode', 'createUserProfile', 'getUserAccount', 'updateNickname'])('%s exposes only a non-mutating gone response', async (name) => {
    const handler = require(`../../${name}/index.js`).main;
    await expect(handler({ code: 'must-not-be-read' })).resolves.toEqual({ ok: false, errorCode: 'GONE', message: 'Invitation registration has been retired' });
  });
});
