import type { z } from 'zod';
import type {
  AdminOperationInputSchema,
  AdminOperationResponseSchema,
  AgeConsentInputSchema,
  AgeConsentResponseSchema,
  AuthenticatedUserSchema,
  CommentInputSchema,
  CommentSchema,
  ContentRatingSchema,
  LoginInputSchema,
  LoginResponseSchema,
  R18AssetAccessInputSchema,
  R18AssetAccessResponseSchema,
  ReadingProgressInputSchema,
  ReadingProgressSchema,
  RecoveryCodeInputSchema,
  RecoveryCodeResponseSchema,
  RecoveryConfirmationInputSchema,
  RecoveryConfirmationResponseSchema,
  RegistrationChallengeAnswerInputSchema,
  RegistrationChallengeAnswerResponseSchema,
  RegistrationChallengeRequestSchema,
  RegistrationChallengeResponseSchema,
  RegistrationInputSchema,
  RegistrationResponseSchema,
  MeResponseSchema,
  SubmissionInputSchema,
  SubmissionResponseSchema,
  WorkSummaryInputSchema,
  WorkSummarySchema,
} from './schemas';

export type ContentRating = z.infer<typeof ContentRatingSchema>;
export type RegistrationChallengeRequest = z.infer<typeof RegistrationChallengeRequestSchema>;
export type RegistrationChallengeResponse = z.infer<typeof RegistrationChallengeResponseSchema>;
export type RegistrationChallengeAnswerInput = z.infer<typeof RegistrationChallengeAnswerInputSchema>;
export type RegistrationChallengeAnswerResponse = z.infer<typeof RegistrationChallengeAnswerResponseSchema>;
export type RegistrationInput = z.infer<typeof RegistrationInputSchema>;
export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;
export type AgeConsentInput = z.infer<typeof AgeConsentInputSchema>;
export type AgeConsentResponse = z.infer<typeof AgeConsentResponseSchema>;
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type RecoveryCodeInput = z.infer<typeof RecoveryCodeInputSchema>;
export type RecoveryCodeResponse = z.infer<typeof RecoveryCodeResponseSchema>;
export type RecoveryConfirmationInput = z.infer<typeof RecoveryConfirmationInputSchema>;
export type RecoveryConfirmationResponse = z.infer<typeof RecoveryConfirmationResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type WorkSummaryInput = z.infer<typeof WorkSummaryInputSchema>;
export type WorkSummary = z.infer<typeof WorkSummarySchema>;
export type CommentInput = z.infer<typeof CommentInputSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type ReadingProgressInput = z.infer<typeof ReadingProgressInputSchema>;
export type ReadingProgress = z.infer<typeof ReadingProgressSchema>;
export type SubmissionInput = z.infer<typeof SubmissionInputSchema>;
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;
export type R18AssetAccessInput = z.infer<typeof R18AssetAccessInputSchema>;
export type R18AssetAccessResponse = z.infer<typeof R18AssetAccessResponseSchema>;
export type AdminOperationInput = z.infer<typeof AdminOperationInputSchema>;
export type AdminOperationResponse = z.infer<typeof AdminOperationResponseSchema>;
export type AdminOperation = AdminOperationInput['operation'];
