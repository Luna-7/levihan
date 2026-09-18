'use strict';

const crypto = require('crypto');
const { ApiError } = require('../../errors');
const { setSessionCookies, clearSessionCookies } = require('../../security');
const { constantTimeIncludes, domainHash, generateOpaqueToken, generateRecoveryCode } = require('./session');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE = /^[A-Za-z0-9_-]{43,128}$/;
const RECOVERY = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/;
const USERNAME = /^[a-z0-9_]{3,32}$/;

function canonicalUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USERNAME.test(username)) throw new ApiError(400, 'VALIDATION_FAILED', 'Username must be 3-32 lowercase letters, numbers, or underscores');
  return username;
}

function validPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new ApiError(400, 'VALIDATION_FAILED', 'Password must be 12-128 characters');
  return value;
}

function normalizeAnswer(value, rule) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 256) throw new ApiError(400, 'VALIDATION_FAILED', 'Answer is required');
  if (rule === 'trim') return value.trim();
  if (rule === 'trim_lowercase') return value.trim().toLocaleLowerCase('zh-CN');
  if (rule === 'trim_lowercase_collapse_whitespace') return value.trim().toLocaleLowerCase('zh-CN').replace(/\s+/gu, ' ');
  throw new ApiError(500, 'INTERNAL_ERROR', 'Unsupported answer normalization');
}

function capabilities(role) {
  const base = ['comment', 'favorite', 'submit'];
  return role === 'admin' ? [...base, 'admin'] : base;
}

function safeUser(profile) {
  return { id: profile.id, username: profile.username, role: profile.role, capabilities: capabilities(profile.role), ageConsent: profile.ageConsent ?? null };
}

function requireIp(ctx) {
  if (!ctx.clientIp) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Trusted client IP is unavailable');
  return ctx.clientIp;
}

function strictBody(value, allowed) {
  const body = value === undefined ? {} : value;
  if (!body || Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Request body contains unsupported fields');
  }
  return body;
}

function createAuthService({
  repository,
  passwordHasher,
  pepper,
  now = () => new Date(),
  randomIndex = (upperBound) => crypto.randomInt(upperBound),
  opaqueToken = generateOpaqueToken,
  recoveryCode = generateRecoveryCode,
} = {}) {
  if (!repository || !passwordHasher) {
    const unavailable = async () => { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Authentication service unavailable'); };
    return { createChallenge: unavailable, answerChallenge: unavailable, register: unavailable, login: unavailable, logout: unavailable, recover: unavailable, confirmRecovery: unavailable, regenerateRecovery: unavailable, me: unavailable };
  }
  const plus = (milliseconds) => new Date(now().getTime() + milliseconds);
  const hash = (domain, value) => domainHash(pepper, domain, value);
  const sessionSecrets = () => ({ sessionToken: opaqueToken(), csrfToken: opaqueToken() });

  return {
    async createChallenge(ctx) {
      strictBody(ctx.body, []);
      const questions = await repository.listActiveQuestions();
      if (!Array.isArray(questions) || questions.length === 0) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Registration challenge unavailable');
      const totalWeight = questions.reduce((sum, question) => sum + Math.max(1, Number(question.samplingWeight) || 1), 0);
      let cursor = randomIndex(totalWeight);
      let question = questions[questions.length - 1];
      for (const candidate of questions) {
        cursor -= Math.max(1, Number(candidate.samplingWeight) || 1);
        if (cursor < 0) { question = candidate; break; }
      }
      if (!UUID.test(question.id) || typeof question.prompt !== 'string' || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 8) {
        throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Registration challenge unavailable');
      }
      const expiresAt = plus(5 * 60 * 1000);
      if (!Number.isInteger(question.version) || question.version < 1) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Registration challenge unavailable');
      const created = await repository.createChallenge({ questionIds: [question.id], questionVersions: [question.version], expiresAt: expiresAt.toISOString(), maxAttempts: 3, ipHash: hash('ip', requireIp(ctx)) });
      return { challengeId: created.id, prompt: question.prompt, options: question.options, expiresAt: expiresAt.toISOString() };
    },

    async answerChallenge(ctx) {
      const body = strictBody(ctx.body, ['answer']);
      const challengeId = ctx.params && ctx.params.id;
      if (!UUID.test(challengeId || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid challenge ID');
      const question = await repository.getChallengeQuestion(challengeId);
      if (!question) throw new ApiError(400, 'VALIDATION_FAILED', 'Challenge is invalid or expired');
      const normalized = normalizeAnswer(body.answer, question.normalizationRule);
      const isCorrect = constantTimeIncludes(question.acceptedAnswerHashes, hash('question-answer', normalized));
      const ticket = opaqueToken();
      const expiresAt = plus(10 * 60 * 1000);
      const result = await repository.answerChallenge({
        challengeId, isCorrect, scoreDelta: isCorrect ? 1 : 0, passingScore: 1,
        ticketTokenHash: hash('registration-ticket', ticket), ticketExpiresAt: expiresAt.toISOString(),
      });
      if (!result.passed) throw new ApiError(400, 'VALIDATION_FAILED', 'Answer was not accepted');
      return { registrationTicket: ticket, expiresAt: expiresAt.toISOString() };
    },

    async register(ctx) {
      const body = strictBody(ctx.body, ['registrationTicket', 'username', 'password']);
      if (!OPAQUE.test(body.registrationTicket || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Registration could not be completed');
      const username = canonicalUsername(body.username);
      const password = validPassword(body.password);
      const ticketTokenHash = hash('registration-ticket', body.registrationTicket);
      const ticketValid = await repository.validateRegistrationTicket(ticketTokenHash);
      if (!ticketValid) throw new ApiError(400, 'VALIDATION_FAILED', 'Registration could not be completed');
      const passwordHash = await passwordHasher.hash(password);
      const recovery = recoveryCode();
      const secrets = sessionSecrets();
      const result = await repository.consumeRegistrationTicket({
        ticketTokenHash, username, passwordHash,
        sessionTokenHash: hash('session', secrets.sessionToken),
        recoveryCodeHash: hash('recovery-code', recovery), ipHash: hash('ip', requireIp(ctx)),
      });
      setSessionCookies(ctx, secrets.sessionToken, secrets.csrfToken);
      return { userId: result.userId, username, recoveryCode: recovery };
    },

    async login(ctx) {
      const body = strictBody(ctx.body, ['username', 'password']);
      const username = canonicalUsername(body.username);
      const password = validPassword(body.password);
      const profile = await repository.findUserByUsername(username);
      let accepted = false;
      if (profile && profile.status === 'active' && profile.credentialState !== 'migration_required') {
        try { accepted = await passwordHasher.verify(profile.passwordHash, password); } catch { accepted = false; }
      } else {
        await passwordHasher.hash(password);
      }
      if (!accepted) throw new ApiError(401, 'AUTH_REQUIRED', 'Invalid username or password');
      const secrets = sessionSecrets();
      const currentToken = ctx.cookies && ctx.cookies[ctx.config.sessionCookieName];
      const loginSession = await repository.createLoginSession({
        userId: profile.id,
        sessionTokenHash: hash('session', secrets.sessionToken),
        currentSessionTokenHash: OPAQUE.test(currentToken || '') ? hash('session', currentToken) : null,
        ipHash: hash('ip', requireIp(ctx)),
      });
      const current = await repository.getUserProfile(profile.id);
      setSessionCookies(ctx, secrets.sessionToken, secrets.csrfToken);
      return { user: safeUser(current), session: { expiresAt: loginSession.expiresAt } };
    },

    async logout(ctx) {
      strictBody(ctx.body, []);
      if (!ctx.actorId) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      const token = ctx.cookies && ctx.cookies[ctx.config.sessionCookieName];
      if (!OPAQUE.test(token || '')) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      await repository.revokeSession(hash('session', token));
      clearSessionCookies(ctx);
      return { ok: true };
    },

    async recover(ctx) {
      const body = strictBody(ctx.body, ['recoveryCode', 'newPassword']);
      if (!RECOVERY.test(body.recoveryCode || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Recovery request could not be completed');
      const newPasswordHash = await passwordHasher.hash(validPassword(body.newPassword));
      const replacement = recoveryCode();
      const secrets = sessionSecrets();
      const result = await repository.consumeRecoveryCode({
        recoveryCodeHash: hash('recovery-code', body.recoveryCode), newPasswordHash,
        newRecoveryCodeHash: hash('recovery-code', replacement), sessionTokenHash: hash('session', secrets.sessionToken),
        ipHash: hash('ip', requireIp(ctx)),
      });
      const profile = await repository.getUserProfile(result.userId);
      setSessionCookies(ctx, secrets.sessionToken, secrets.csrfToken);
      return { user: safeUser(profile), session: { expiresAt: result.expiresAt }, recoveryCode: replacement };
    },

    async regenerateRecovery(ctx) {
      const body = strictBody(ctx.body, ['password']);
      const token = ctx.cookies && ctx.cookies[ctx.config.sessionCookieName];
      if (!OPAQUE.test(token || '')) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      const sessionTokenHash = hash('session', token);
      const credential = await repository.getUnconfirmedRecoveryCredential(sessionTokenHash);
      let accepted = false;
      try { accepted = credential && await passwordHasher.verify(credential.passwordHash, validPassword(body.password)); } catch { accepted = false; }
      if (!accepted) throw new ApiError(401, 'AUTH_REQUIRED', 'Invalid password');
      const replacement = recoveryCode();
      await repository.regenerateUnconfirmedRecoveryCode({
        sessionTokenHash, expectedPasswordHash: credential.passwordHash,
        recoveryCodeHash: hash('recovery-code', replacement), requestId: ctx.requestId,
      });
      return { recoveryCode: replacement };
    },

    async confirmRecovery(ctx) {
      const body = strictBody(ctx.body, ['recoveryCode']);
      if (!RECOVERY.test(body.recoveryCode || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Recovery confirmation could not be completed');
      const token = ctx.cookies && ctx.cookies[ctx.config.sessionCookieName];
      if (!OPAQUE.test(token || '')) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      const result = await repository.confirmRecoveryCode({
        sessionTokenHash: hash('session', token),
        recoveryCodeHash: hash('recovery-code', body.recoveryCode),
      });
      const profile = result.profile;
      if (!profile || profile.status !== 'active') throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      return { confirmed: true, user: safeUser(profile) };
    },

    async me(ctx) {
      if (!ctx.actorId) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      const profile = await repository.getUserProfile(ctx.actorId);
      if (!profile || profile.status !== 'active') throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      return { user: { id: profile.id, username: profile.username }, role: profile.role, capabilities: capabilities(profile.role), ageConsent: profile.ageConsent ?? null };
    },
  };
}

module.exports = { canonicalUsername, normalizeAnswer, createAuthService };
