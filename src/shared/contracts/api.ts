export type ContentRating = 'general' | 'r18';

export type RegistrationChallengeRequest = Record<string, never>;

export interface RegistrationChallengeResponse {
  challengeId: string;
  prompt: string;
  expiresAt: string;
}

export interface RegistrationInput {
  challengeId: string;
  answer: string;
  username: string;
  password: string;
}

export interface RegistrationResponse {
  userId: string;
  username: string;
  recoveryCode: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  adultDeclared: boolean;
}

export interface LoginResponse {
  accessToken: string;
  expiresAt: string;
  user: AuthenticatedUser;
}

export interface RecoveryCodeInput {
  recoveryCode: string;
  newPassword: string;
}

export interface RecoveryCodeResponse {
  accessToken: string;
  expiresAt: string;
}

export interface WorkSummaryInput {
  title: string;
  summary: string;
  contentRating: ContentRating;
}

export interface WorkSummary extends WorkSummaryInput {
  id: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentInput {
  workId: string;
  body: string;
}

export interface Comment {
  id: string;
  workId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ReadingProgressInput {
  workId: string;
  position: number;
}

export interface ReadingProgress extends ReadingProgressInput {
  updatedAt: string;
}

export type SubmissionInput =
  | {
      title: string;
      body: string;
      contentRating: 'general';
    }
  | {
      title: string;
      body: string;
      contentRating: 'r18';
      adultDeclared: true;
    };

export interface SubmissionResponse {
  submissionId: string;
  status: 'pending';
  createdAt: string;
}

export interface R18AssetAccessInput {
  workId: string;
  adultDeclared: true;
}

export interface R18AssetAccessResponse {
  signedUrl: string;
  expiresInSeconds: number;
}

export type AdminOperation =
  | 'approve_submission'
  | 'reject_submission'
  | 'remove_comment'
  | 'unpublish_work';

export interface AdminOperationInput {
  operation: AdminOperation;
  targetId: string;
}

export interface AdminOperationResponse {
  targetId: string;
  status: 'completed';
}
