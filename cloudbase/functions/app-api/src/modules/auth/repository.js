'use strict';

const { ApiError } = require('../../errors');

function dependency() {
  return new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Authentication storage unavailable');
}

function unwrap(result) {
  if (!result || result.error) throw dependency();
  return result.data;
}

function first(data) {
  return Array.isArray(data) ? data[0] : data;
}

function rpcRow(result, operation) {
  if (!result || result.error) {
    if (operation === 'register' && result && result.error && String(result.error.code) === '23505') {
      throw new ApiError(409, 'STATE_CONFLICT', 'Username is unavailable');
    }
    if (['register', 'answer', 'recover', 'logout'].includes(operation) && result && result.error && String(result.error.code) === '23514') {
      throw new ApiError(operation === 'logout' ? 401 : 400, operation === 'logout' ? 'AUTH_REQUIRED' : 'VALIDATION_FAILED', operation === 'recover' ? 'Recovery request could not be completed' : 'Request could not be completed');
    }
    throw dependency();
  }
  return first(result.data);
}

function mapQuestion(row) {
  return {
    id: row.id,
    prompt: row.prompt,
    options: row.options,
    acceptedAnswerHashes: row.accepted_answer_hashes,
    normalizationRule: row.normalization_rule,
    samplingWeight: row.sampling_weight,
  };
}

function createAuthRepository({ rdb }) {
  if (!rdb || typeof rdb.from !== 'function' || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().from/rpc adapters are required for authentication');
  return {
    async listActiveQuestions() {
      const result = await rdb.from('question_bank').select('id,prompt,options,accepted_answer_hashes,normalization_rule,sampling_weight').eq('status', 'active');
      const data = unwrap(result);
      if (!Array.isArray(data)) throw dependency();
      return data.map(mapQuestion);
    },

    async createChallenge({ questionIds, expiresAt, maxAttempts, ipHash }) {
      const result = await rdb.from('registration_challenges').insert({ question_ids: questionIds, expires_at: expiresAt, max_attempts: maxAttempts, ip_hash: ipHash }).select('id');
      const row = first(unwrap(result));
      if (!row || typeof row.id !== 'string') throw dependency();
      return { id: row.id };
    },

    async getChallengeQuestion(challengeId) {
      const challengeResult = await rdb.from('registration_challenges').select('question_ids,status,expires_at,attempt_count,max_attempts').eq('id', challengeId).limit(1);
      const challenge = first(unwrap(challengeResult));
      if (!challenge || challenge.status !== 'pending' || new Date(challenge.expires_at) <= new Date() || challenge.attempt_count >= challenge.max_attempts) return null;
      const questionId = Array.isArray(challenge.question_ids) ? challenge.question_ids[0] : undefined;
      if (!questionId) throw dependency();
      const questionResult = await rdb.from('question_bank').select('id,prompt,options,accepted_answer_hashes,normalization_rule,sampling_weight').eq('id', questionId).limit(1);
      const question = first(unwrap(questionResult));
      return question ? mapQuestion(question) : null;
    },

    async answerChallenge({ challengeId, isCorrect, scoreDelta, passingScore, ticketTokenHash, ticketExpiresAt }) {
      const result = await rdb.rpc('answer_registration_challenge', {
        p_challenge_id: challengeId, p_is_correct: isCorrect, p_score_delta: scoreDelta, p_passing_score: passingScore,
        p_ticket_token_hash: ticketTokenHash, p_ticket_expires_at: ticketExpiresAt,
      });
      const value = rpcRow(result, 'answer');
      const ticketId = value && typeof value === 'object' ? Object.values(value)[0] : value;
      return { passed: typeof ticketId === 'string', ticketId: typeof ticketId === 'string' ? ticketId : null };
    },

    async consumeRegistrationTicket(input) {
      const row = rpcRow(await rdb.rpc('consume_registration_ticket', {
        p_ticket_token_hash: input.ticketTokenHash, p_username: input.username, p_password_hash: input.passwordHash,
        p_session_token_hash: input.sessionTokenHash, p_session_expires_at: input.sessionExpiresAt,
        p_recovery_code_hash: input.recoveryCodeHash, p_ip_hash: input.ipHash,
      }), 'register');
      if (!row || typeof row.user_id !== 'string' || typeof row.session_id !== 'string') throw dependency();
      return { userId: row.user_id, sessionId: row.session_id };
    },

    async findUserByUsername(username) {
      const result = await rdb.from('app_users').select('id,username,password_hash,role,status').eq('username', username).limit(1);
      const row = first(unwrap(result));
      return row ? { id: row.id, username: row.username, passwordHash: row.password_hash, role: row.role, status: row.status } : null;
    },

    async createLoginSession(input) {
      const value = rpcRow(await rdb.rpc('create_login_session', {
        p_user_id: input.userId, p_token_hash: input.sessionTokenHash, p_expires_at: input.sessionExpiresAt, p_ip_hash: input.ipHash,
      }), 'login');
      const sessionId = value && typeof value === 'object' ? Object.values(value)[0] : value;
      if (typeof sessionId !== 'string') throw dependency();
      return { sessionId };
    },

    async revokeSession(tokenHash) {
      const value = rpcRow(await rdb.rpc('revoke_user_session', { p_token_hash: tokenHash }), 'logout');
      const revoked = value && typeof value === 'object' ? Object.values(value)[0] : value;
      if (revoked !== true) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      return true;
    },

    async consumeRecoveryCode(input) {
      const row = rpcRow(await rdb.rpc('consume_recovery_code', {
        p_code_hash: input.recoveryCodeHash, p_new_password_hash: input.newPasswordHash,
        p_new_recovery_code_hash: input.newRecoveryCodeHash, p_session_token_hash: input.sessionTokenHash,
        p_session_expires_at: input.sessionExpiresAt, p_ip_hash: input.ipHash,
      }), 'recover');
      if (!row || typeof row.user_id !== 'string' || typeof row.session_id !== 'string') throw dependency();
      return { userId: row.user_id, sessionId: row.session_id };
    },

    async getUserProfile(userId) {
      const userResult = await rdb.from('app_users').select('id,username,role,status').eq('id', userId).limit(1);
      const user = first(unwrap(userResult));
      if (!user) return null;
      const consentResult = await rdb.from('age_consents').select('policy_version,accepted_at').eq('user_id', userId).is('revoked_at', null).order('accepted_at', { ascending: false }).limit(1);
      const consent = first(unwrap(consentResult));
      return {
        id: user.id, username: user.username, role: user.role, status: user.status,
        ageConsent: consent ? { policyVersion: consent.policy_version, acceptedAt: new Date(consent.accepted_at).toISOString() } : null,
      };
    },
  };
}

module.exports = { createAuthRepository };
