import { describe, expect, it } from 'vitest';
import {
  AdminOperationInputSchema,
  CommentInputSchema,
  LoginInputSchema,
  ReadingProgressInputSchema,
  RecoveryCodeInputSchema,
  RegistrationChallengeRequestSchema,
  RegistrationInputSchema,
  SubmissionInputSchema,
  WorkSummaryInputSchema,
} from './schemas';

describe('shared API validation contracts', () => {
  it('accepts complete payloads for every supported operation', () => {
    expect(RegistrationChallengeRequestSchema.safeParse({}).success).toBe(true);
    expect(RegistrationInputSchema.safeParse({
      challengeId: '550e8400-e29b-41d4-a716-446655440000',
      answer: '夏天',
      username: 'reader_01',
      password: 'a-secure-password',
    }).success).toBe(true);
    expect(LoginInputSchema.safeParse({
      username: 'reader_01',
      password: 'a-secure-password',
    }).success).toBe(true);
    expect(RecoveryCodeInputSchema.safeParse({
      recoveryCode: 'ABCD-EFGH-JKLM-NPQR',
      newPassword: 'a-new-secure-password',
    }).success).toBe(true);
    expect(WorkSummaryInputSchema.safeParse({
      title: '远方的故事',
      summary: '一段简短摘要。',
      contentRating: 'general',
    }).success).toBe(true);
    expect(CommentInputSchema.safeParse({
      workId: '550e8400-e29b-41d4-a716-446655440001',
      body: '很喜欢这一章。',
    }).success).toBe(true);
    expect(ReadingProgressInputSchema.safeParse({
      workId: '550e8400-e29b-41d4-a716-446655440001',
      position: 42,
    }).success).toBe(true);
    expect(SubmissionInputSchema.safeParse({
      title: '我的投稿',
      body: '正文内容',
      contentRating: 'general',
    }).success).toBe(true);
    expect(AdminOperationInputSchema.safeParse({
      operation: 'approve_submission',
      targetId: '550e8400-e29b-41d4-a716-446655440002',
    }).success).toBe(true);
  });

  it('rejects registration when a required challenge answer is missing', () => {
    expect(RegistrationInputSchema.safeParse({
      challengeId: '550e8400-e29b-41d4-a716-446655440000',
      username: 'reader_01',
      password: 'a-secure-password',
    }).success).toBe(false);
  });

  it('rejects strings and progress values outside their supported boundaries', () => {
    expect(LoginInputSchema.safeParse({
      username: 'a',
      password: 'a-secure-password',
    }).success).toBe(false);
    expect(CommentInputSchema.safeParse({
      workId: '550e8400-e29b-41d4-a716-446655440001',
      body: 'x'.repeat(2_001),
    }).success).toBe(false);
    expect(ReadingProgressInputSchema.safeParse({
      workId: '550e8400-e29b-41d4-a716-446655440001',
      position: -1,
    }).success).toBe(false);
  });

  it('rejects unknown input fields instead of silently accepting them', () => {
    expect(LoginInputSchema.safeParse({
      username: 'reader_01',
      password: 'a-secure-password',
      isAdmin: true,
    }).success).toBe(false);
  });
});
