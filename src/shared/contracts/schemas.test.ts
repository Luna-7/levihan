import { describe, expect, it } from 'vitest';
import {
  CommentInputSchema,
  RegistrationInputSchema,
  R18AssetAccessInputSchema,
} from './schemas';
import * as schemas from './schemas';

const id = '550e8400-e29b-41d4-a716-446655440000';
const timestamp = '2026-09-17T12:00:00.000Z';
const laterTimestamp = '2026-09-17T12:10:00.000Z';

type SafeParser = {
  safeParse(value: unknown): { success: boolean };
};

const schema = (name: string) => (
  schemas as unknown as Record<string, SafeParser | undefined>
)[name];

describe('shared API validation contracts', () => {
  it('accepts all response payloads without putting access tokens in JSON', () => {
    const responses: Array<[string, unknown]> = [
      ['RegistrationChallengeResponseSchema', { challengeId: id, prompt: '选择夏天对应的选项', options: ['春天', '夏天', '秋天'], expiresAt: timestamp }],
      ['RegistrationChallengeAnswerResponseSchema', { registrationTicket: id, expiresAt: timestamp }],
      ['RegistrationResponseSchema', { userId: id, username: 'reader_01', recoveryCode: 'ABCD-EFGH-JKLM-NPQR' }],
      ['AuthenticatedUserSchema', { id, username: 'reader_01', ageConsent: { policyVersion: '2026-09', acceptedAt: timestamp } }],
      ['LoginResponseSchema', { user: { id, username: 'reader_01', ageConsent: null }, session: { expiresAt: laterTimestamp } }],
      ['RecoveryCodeResponseSchema', { user: { id, username: 'reader_01', ageConsent: null }, session: { expiresAt: laterTimestamp } }],
      ['WorkSummarySchema', { id, title: '远方的故事', summary: '一段简短摘要。', contentRating: 'general', authorName: 'writer_01', createdAt: timestamp, updatedAt: timestamp }],
      ['CommentSchema', { id, workId: id, authorName: 'reader_01', body: '很喜欢这一章。', createdAt: timestamp }],
      ['ReadingProgressSchema', { workId: id, position: 42, percent: 20, clientVersion: 2, clientUpdatedAt: timestamp, version: 3, updatedAt: timestamp }],
      ['SubmissionResponseSchema', { submissionId: id, status: 'pending', createdAt: timestamp }],
      ['AgeConsentResponseSchema', { policyVersion: '2026-09', acceptedAt: timestamp }],
      ['R18AssetAccessResponseSchema', { signedUrl: 'https://private.example.com/object?signature=short-lived', expiresAt: laterTimestamp }],
      ['AdminOperationResponseSchema', { targetId: id, status: 'completed' }],
    ];

    for (const [name, payload] of responses) {
      expect(schema(name)?.safeParse(payload).success, name).toBe(true);
    }

    expect(schema('LoginResponseSchema')?.safeParse({
      user: { id, username: 'reader_01', ageConsent: null },
      session: { expiresAt: laterTimestamp },
      accessToken: 'must-never-be-in-json',
    }).success).toBe(false);
    expect(schema('RecoveryCodeResponseSchema')?.safeParse({
      user: { id, username: 'reader_01', ageConsent: null },
      session: { expiresAt: laterTimestamp },
      accessToken: 'must-never-be-in-json',
    }).success).toBe(false);
  });

  it('uses a short-lived ticket after answering a registration challenge', () => {
    expect(schema('RegistrationChallengeAnswerInputSchema')?.safeParse({ challengeId: id, answer: ' 夏天 ' }).success).toBe(true);
    expect(schema('RegistrationChallengeAnswerResponseSchema')?.safeParse({ registrationTicket: id, expiresAt: timestamp }).success).toBe(true);

    const registration = RegistrationInputSchema.safeParse({ username: 'reader_01', password: 'a-secure-password' });
    expect(registration.success).toBe(false);
    if (registration.success) throw new Error('registration ticket must be required');
    expect(registration.error.issues[0]).toMatchObject({ path: ['registrationTicket'], code: 'invalid_type' });
  });

  it('records versioned age consent and keeps R18 declarations out of access requests', () => {
    expect(schema('AgeConsentInputSchema')?.safeParse({ policyVersion: '2026-09', acceptedAt: timestamp }).success).toBe(true);
    expect(schema('AgeConsentInputSchema')?.safeParse({ policyVersion: '2026-09' }).success).toBe(false);
    expect(schema('AgeConsentInputSchema')?.safeParse({ policyVersion: '2026-09', acceptedAt: timestamp, isAdmin: true }).success).toBe(false);

    expect(R18AssetAccessInputSchema.safeParse({ workId: id }).success).toBe(true);
    expect(R18AssetAccessInputSchema.safeParse({ workId: id, adultDeclared: true }).success).toBe(false);
  });

  it('records progress with ordered client updates and rejects boundary violations', () => {
    expect(schema('ReadingProgressInputSchema')?.safeParse({ workId: id, position: 42, percent: 20, clientVersion: 2, clientUpdatedAt: timestamp }).success).toBe(true);
    expect(schema('ReadingProgressInputSchema')?.safeParse({ workId: id, position: 42, percent: 101, clientVersion: 2, clientUpdatedAt: timestamp }).success).toBe(false);
    expect(schema('ReadingProgressInputSchema')?.safeParse({ workId: id, position: 42, percent: 20, clientVersion: 0, clientUpdatedAt: timestamp }).success).toBe(false);
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
