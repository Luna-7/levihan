# Archived nickname/password CloudBase authentication

This directory preserves the remote branch's pre-v2 custom-login functions and
SQL only for audit and legacy data interpretation. It is not a CloudBase
function root and is not part of the PostgreSQL v2 migration sequence.

Never deploy these functions or apply these migrations. They bypass the v2
quiz-registration, recovery-code, session, CSRF, rate-limit, and audit model.
Legacy users must use the controlled `#/migrate-account` flow documented in the
backend-v2 runbook.
