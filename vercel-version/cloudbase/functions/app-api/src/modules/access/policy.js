'use strict';

const WORK_STATES = new Set(['draft', 'review', 'published', 'archived', 'deleted']);
const RATINGS = new Set(['general', 'mature', 'restricted']);
const CONSENTS = new Set(['current', 'missing', 'revoked', 'stale']);

function decideAccess({ actor, workStatus, rating, consent }) {
  if (!WORK_STATES.has(workStatus) || !RATINGS.has(rating) || !CONSENTS.has(consent)) return { allowed: false, safeMetadataOnly: rating === 'restricted', errorCode: 'ACCESS_DENIED' };
  const restricted = rating === 'restricted';
  if (!actor) return workStatus === 'published' ? { allowed: false, safeMetadataOnly: restricted, errorCode: 'AUTH_REQUIRED' } : { allowed: false, safeMetadataOnly: false, errorCode: 'NOT_FOUND' };
  if (actor.status !== 'active') return { allowed: false, safeMetadataOnly: restricted && workStatus === 'published', errorCode: 'ACCESS_DENIED' };
  if (workStatus === 'deleted') return { allowed: false, safeMetadataOnly: false, errorCode: 'NOT_FOUND' };
  if (actor.role === 'admin') return { allowed: true, safeMetadataOnly: false, errorCode: null };
  if (workStatus !== 'published') return { allowed: false, safeMetadataOnly: false, errorCode: 'NOT_FOUND' };
  if (restricted && consent !== 'current') return { allowed: false, safeMetadataOnly: true, errorCode: 'AGE_CONSENT_REQUIRED' };
  return { allowed: true, safeMetadataOnly: false, errorCode: null };
}

module.exports = { decideAccess };
