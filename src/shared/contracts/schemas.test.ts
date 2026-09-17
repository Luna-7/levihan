import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AdminOperationInputSchema,
  AdminOperationResponseSchema,
  AgeConsentInputSchema,
  AgeConsentResponseSchema,
  AuthenticatedUserSchema,
  CommentInputSchema,
  CommentSchema,
  LoginInputSchema,
  LoginResponseSchema,
  R18AssetAccessInputSchema,
  R18AssetAccessResponseSchema,
  ReadingProgressInputSchema,
  ReadingProgressSchema,
  RecoveryCodeInputSchema,
  RecoveryCodeResponseSchema,
  RegistrationChallengeAnswerInputSchema,
  RegistrationChallengeAnswerResponseSchema,
  RegistrationChallengeRequestSchema,
  RegistrationChallengeResponseSchema,
  RegistrationInputSchema,
  RegistrationResponseSchema,
  SubmissionInputSchema,
  SubmissionResponseSchema,
  WorkSummaryInputSchema,
  WorkSummarySchema,
} from './schemas';

const id = '550e8400-e29b-41d4-a716-446655440000';
const timestamp = '2026-09-17T12:00:00.000Z';
const laterTimestamp = '2026-09-17T12:10:00.000Z';
type SchemaCase = readonly [name: string, schema: z.ZodTypeAny, payload: Record<string, unknown>];

describe('shared API validation contracts', () => {
  it('accepts every documented input payload', () => {
    const inputs: SchemaCase[] = [
      ['registration challenge request', RegistrationChallengeRequestSchema, {}],
      ['registration challenge answer', RegistrationChallengeAnswerInputSchema, { challengeId: id, answer: '夏天' }],
      ['registration', RegistrationInputSchema, { registrationTicket: id, username: 'reader_01', password: 'a-secure-password' }],
      ['login', LoginInputSchema, { username: 'reader_01', password: 'a-secure-password' }],
      ['recovery code', RecoveryCodeInputSchema, { recoveryCode: 'ABCD-EFGH-JKLM-NPQR', newPassword: 'a-new-secure-password' }],
      ['work summary', WorkSummaryInputSchema, { title: '远方的故事', summary: '一段简短摘要。', contentRating: 'general' }],
      ['comment', CommentInputSchema, { workId: id, body: '很喜欢这一章。' }],
      ['reading progress', ReadingProgressInputSchema, { workId: id, position: 42, percent: 20, clientVersion: 2, clientUpdatedAt: timestamp }],
      ['general submission', SubmissionInputSchema, { title: '我的投稿', body: '正文内容', contentRating: 'general' }],
      ['R18 submission', SubmissionInputSchema, { title: '我的投稿', body: '正文内容', contentRating: 'r18' }],
      ['age consent', AgeConsentInputSchema, { policyVersion: '2026-09' }],
      ['R18 asset access', R18AssetAccessInputSchema, { workId: id }],
      ['admin operation', AdminOperationInputSchema, { operation: 'approve_submission', targetId: id }],
    ];

    for (const [name, inputSchema, payload] of inputs) {
      expect(inputSchema.safeParse(payload).success, name).toBe(true);
    }
  });

  it('rejects unknown fields for every input schema', () => {
    const inputs: SchemaCase[] = [
      ['registration challenge request', RegistrationChallengeRequestSchema, {}],
      ['registration challenge answer', RegistrationChallengeAnswerInputSchema, { challengeId: id, answer: '夏天' }],
      ['registration', RegistrationInputSchema, { registrationTicket: id, username: 'reader_01', password: 'a-secure-password' }],
      ['login', LoginInputSchema, { username: 'reader_01', password: 'a-secure-password' }],
      ['recovery code', RecoveryCodeInputSchema, { recoveryCode: 'ABCD-EFGH-JKLM-NPQR', newPassword: 'a-new-secure-password' }],
      ['work summary', WorkSummaryInputSchema, { title: '远方的故事', summary: '一段简短摘要。', contentRating: 'general' }],
      ['comment', CommentInputSchema, { workId: id, body: '很喜欢这一章。' }],
      ['reading progress', ReadingProgressInputSchema, { workId: id, position: 42, percent: 20, clientVersion: 2, clientUpdatedAt: timestamp }],
      ['general submission', SubmissionInputSchema, { title: '我的投稿', body: '正文内容', contentRating: 'general' }],
      ['R18 submission', SubmissionInputSchema, { title: '我的投稿', body: '正文内容', contentRating: 'r18' }],
      ['age consent', AgeConsentInputSchema, { policyVersion: '2026-09' }],
      ['R18 asset access', R18AssetAccessInputSchema, { workId: id }],
      ['admin operation', AdminOperationInputSchema, { operation: 'approve_submission', targetId: id }],
    ];

    for (const [name, inputSchema, payload] of inputs) {
      expect(inputSchema.safeParse({ ...payload, unexpected: true }).success, name).toBe(false);
    }
  });

  it('accepts every documented response payload without putting access tokens in JSON', () => {
    const responses: SchemaCase[] = [
      ['registration challenge response', RegistrationChallengeResponseSchema, { challengeId: id, prompt: '选择夏天对应的选项', options: ['春天', '夏天', '秋天'], expiresAt: timestamp }],
      ['registration ticket response', RegistrationChallengeAnswerResponseSchema, { registrationTicket: id, expiresAt: timestamp }],
      ['registration response', RegistrationResponseSchema, { userId: id, username: 'reader_01', recoveryCode: 'ABCD-EFGH-JKLM-NPQR' }],
      ['authenticated user', AuthenticatedUserSchema, { id, username: 'reader_01', ageConsent: { policyVersion: '2026-09', acceptedAt: timestamp } }],
      ['login response', LoginResponseSchema, { user: { id, username: 'reader_01', ageConsent: null }, session: { expiresAt: laterTimestamp } }],
      ['recovery response', RecoveryCodeResponseSchema, { user: { id, username: 'reader_01', ageConsent: null }, session: { expiresAt: laterTimestamp } }],
      ['work summary response', WorkSummarySchema, { id, title: '远方的故事', summary: '一段简短摘要。', contentRating: 'general', authorName: 'writer_01', createdAt: timestamp, updatedAt: timestamp }],
      ['comment response', CommentSchema, { id, workId: id, authorName: 'reader_01', body: '很喜欢这一章。', createdAt: timestamp }],
      ['reading progress response', ReadingProgressSchema, { workId: id, position: 42, percent: 20, clientVersion: 2, clientUpdatedAt: timestamp, version: 3, updatedAt: timestamp }],
      ['submission response', SubmissionResponseSchema, { submissionId: id, status: 'pending', createdAt: timestamp }],
      ['age consent response', AgeConsentResponseSchema, { policyVersion: '2026-09', acceptedAt: timestamp }],
      ['R18 asset response', R18AssetAccessResponseSchema, { signedUrl: 'https://private.example.com/object?signature=short-lived', expiresAt: laterTimestamp, expiresInSeconds: 300 }],
      ['admin response', AdminOperationResponseSchema, { targetId: id, status: 'completed' }],
    ];

    for (const [name, responseSchema, payload] of responses) {
      expect(responseSchema.safeParse(payload).success, name).toBe(true);
    }

    expect(LoginResponseSchema.safeParse({
      user: { id, username: 'reader_01', ageConsent: null },
      session: { expiresAt: laterTimestamp },
      accessToken: 'must-never-be-in-json',
    }).success).toBe(false);
    expect(RecoveryCodeResponseSchema.safeParse({
      user: { id, username: 'reader_01', ageConsent: null },
      session: { expiresAt: laterTimestamp },
      accessToken: 'must-never-be-in-json',
    }).success).toBe(false);
  });

  it('limits R18 signed URLs to a five-to-ten minute TTL', () => {
    const payload = { signedUrl: 'https://private.example.com/object?signature=short-lived', expiresAt: laterTimestamp };
    expect(R18AssetAccessResponseSchema.safeParse({ ...payload, expiresInSeconds: 300 }).success).toBe(true);
    expect(R18AssetAccessResponseSchema.safeParse({ ...payload, expiresInSeconds: 600 }).success).toBe(true);
    expect(R18AssetAccessResponseSchema.safeParse({ ...payload, expiresInSeconds: 299 }).success).toBe(false);
    expect(R18AssetAccessResponseSchema.safeParse({ ...payload, expiresInSeconds: 601 }).success).toBe(false);
  });

  it('accepts only a policy version when recording age consent', () => {
    expect(AgeConsentInputSchema.safeParse({ policyVersion: '2026-09' }).success).toBe(true);
    expect(AgeConsentInputSchema.safeParse({
      policyVersion: '2026-09',
      acceptedAt: '2099-01-01T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('rejects meaningful missing fields and boundary violations', () => {
    const missingTicket = RegistrationInputSchema.safeParse({ username: 'reader_01', password: 'a-secure-password' });
    expect(missingTicket.success).toBe(false);
    if (missingTicket.success) throw new Error('registration ticket must be required');
    expect(missingTicket.error.issues[0]).toMatchObject({ path: ['registrationTicket'], code: 'invalid_type' });
    expect(RegistrationChallengeAnswerInputSchema.safeParse({ challengeId: id, answer: '   ' }).success).toBe(false);
    expect(LoginInputSchema.safeParse({ username: 'a', password: 'a-secure-password' }).success).toBe(false);
    expect(RecoveryCodeInputSchema.safeParse({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR', newPassword: 'short' }).success).toBe(false);
    expect(WorkSummaryInputSchema.safeParse({ title: 'x'.repeat(121), summary: '摘要', contentRating: 'general' }).success).toBe(false);
    expect(CommentInputSchema.safeParse({ workId: id, body: 'x'.repeat(2_001) }).success).toBe(false);
    expect(ReadingProgressInputSchema.safeParse({ workId: id, position: 42, percent: 101, clientVersion: 2, clientUpdatedAt: timestamp }).success).toBe(false);
    expect(SubmissionInputSchema.safeParse({ title: '投稿', contentRating: 'r18' }).success).toBe(false);
    expect(AgeConsentInputSchema.safeParse({ policyVersion: '' }).success).toBe(false);
    expect(R18AssetAccessInputSchema.safeParse({}).success).toBe(false);
    expect(AdminOperationInputSchema.safeParse({ operation: 'grant_admin', targetId: id }).success).toBe(false);
  });

  it('normalizes trimmed content and reports a useful validation issue', () => {
    const comment = CommentInputSchema.safeParse({ workId: id, body: '  很喜欢这一章。  ' });
    expect(comment.success).toBe(true);
    if (!comment.success) throw new Error('expected trimmed comment to be valid');
    expect(comment.data.body).toBe('很喜欢这一章。');

    const invalid = RegistrationInputSchema.safeParse({ registrationTicket: id, username: 'reader_01', password: 'a-secure-password', ignored: true });
    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error('unknown registration field must be rejected');
    expect(invalid.error.issues).toContainEqual(expect.objectContaining({ code: 'unrecognized_keys', path: [] }));
  });
});
