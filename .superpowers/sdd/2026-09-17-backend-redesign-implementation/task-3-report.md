# Task 3 report — modular API runtime

## Scope

Added the CommonJS CloudBase `app-api` function with an `/api/v1` HTTP kernel. The entry point only assembles injected dependencies and exports `main`; the core is independently testable and does not load the CloudBase SDK until runtime construction.

## RED

Added function-level HTTP and security tests before production modules existed. The first run failed because `../src/http` was absent. After enabling Vitest globals for CommonJS function tests, the failure was specifically `Cannot find module '../src/http'`, establishing the intended RED baseline.

## Implementation

- Added request parsing, JSON response serialization, validated/generated request IDs, router metadata, and public error envelopes.
- Added origin allowlist CORS, rejected foreign-origin preflights, CSP/frame-ancestors, nosniff, referrer, permissions, and HSTS headers.
- Added session/CSRF cookie serialization, constant-time CSRF double-submit checks, and route-level CSRF exemptions.
- Added redacted structured logging, including HMAC-hashed actor IDs only.
- Added a PostgreSQL atomic time-bucket rate-limit repository contract over an injected `rdb().query` adapter. Default policy metadata covers challenge registration, registration, login, comments, submissions, and signed URLs with distinct thresholds.
- Added strict startup configuration checks for CloudBase access key, allowed origins, session-hash pepper, and the production cookie domain.
- Registered `app-api` in `cloudbase/cloudbaserc.json` using environment placeholders only.

## Verification

- Function tests: `npm test -- --run cloudbase/functions/app-api/test` — 2 files, 18 tests passed.
- Full suite: `npm test -- --run` — 6 files, 50 tests passed.
- Type check: `npm run lint` — passed.
- Secret scan: `npm run verify:secrets` — no findings.
- Whitespace check: `git diff --check` — passed.

## Notes

The CloudBase SDK's exact raw-SQL API is isolated behind the injected `rdb().query(sql, params)` adapter. Deployment should confirm that adapter against the installed SDK/runtime; no browser-to-database path is introduced. Business routes remain intentionally out of scope for this task and will opt into CSRF exemptions and rate-limit metadata as they are added.
