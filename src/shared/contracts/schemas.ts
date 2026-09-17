import { z } from 'zod';

const IdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const UsernameSchema = z.string().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/);
const PasswordSchema = z.string().min(12).max(128);
const ContentRatingSchema = z.enum(['general', 'r18']);

export const RegistrationChallengeRequestSchema = z.object({}).strict();
export const RegistrationChallengeResponseSchema = z.object({
  challengeId: IdSchema,
  prompt: z.string().min(1).max(500),
  expiresAt: TimestampSchema,
}).strict();

export const RegistrationInputSchema = z.object({
  challengeId: IdSchema,
  answer: z.string().trim().min(1).max(256),
  username: UsernameSchema,
  password: PasswordSchema,
}).strict();
export const RegistrationResponseSchema = z.object({
  userId: IdSchema,
  username: UsernameSchema,
  recoveryCode: z.string().regex(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/),
}).strict();

export const LoginInputSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
}).strict();
export const AuthenticatedUserSchema = z.object({
  id: IdSchema,
  username: UsernameSchema,
  adultDeclared: z.boolean(),
}).strict();
export const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: TimestampSchema,
  user: AuthenticatedUserSchema,
}).strict();

export const RecoveryCodeInputSchema = z.object({
  recoveryCode: z.string().regex(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/),
  newPassword: PasswordSchema,
}).strict();
export const RecoveryCodeResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: TimestampSchema,
}).strict();

export const WorkSummaryInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2_000),
  contentRating: ContentRatingSchema,
}).strict();
export const WorkSummarySchema = WorkSummaryInputSchema.extend({
  id: IdSchema,
  authorName: z.string().trim().min(1).max(32),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const CommentInputSchema = z.object({
  workId: IdSchema,
  body: z.string().trim().min(1).max(2_000),
}).strict();
export const CommentSchema = CommentInputSchema.extend({
  id: IdSchema,
  authorName: z.string().trim().min(1).max(32),
  createdAt: TimestampSchema,
}).strict();

export const ReadingProgressInputSchema = z.object({
  workId: IdSchema,
  position: z.number().int().min(0).max(10_000_000),
}).strict();
export const ReadingProgressSchema = ReadingProgressInputSchema.extend({
  updatedAt: TimestampSchema,
}).strict();

const GeneralSubmissionInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(100_000),
  contentRating: z.literal('general'),
}).strict();
const R18SubmissionInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(100_000),
  contentRating: z.literal('r18'),
  adultDeclared: z.literal(true),
}).strict();
export const SubmissionInputSchema = z.discriminatedUnion('contentRating', [
  GeneralSubmissionInputSchema,
  R18SubmissionInputSchema,
]);
export const SubmissionResponseSchema = z.object({
  submissionId: IdSchema,
  status: z.literal('pending'),
  createdAt: TimestampSchema,
}).strict();

export const R18AssetAccessInputSchema = z.object({
  workId: IdSchema,
  adultDeclared: z.literal(true),
}).strict();
export const R18AssetAccessResponseSchema = z.object({
  signedUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive().max(900),
}).strict();

export const AdminOperationInputSchema = z.object({
  operation: z.enum([
    'approve_submission',
    'reject_submission',
    'remove_comment',
    'unpublish_work',
  ]),
  targetId: IdSchema,
}).strict();
export const AdminOperationResponseSchema = z.object({
  targetId: IdSchema,
  status: z.literal('completed'),
}).strict();
