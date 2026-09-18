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

The CloudBase SDK's rate-limit integration is isolated behind an injected `rdb.rpc(name, params)` adapter and the controlled PostgreSQL routine. Deployment should confirm that adapter against the installed SDK/runtime; no browser-to-database path is introduced. Business routes remain intentionally out of scope for this task and will opt into CSRF exemptions and rate-limit metadata as they are added.

## Fix round 1

### RED

The new runtime tests first failed for missing multi-cookie output, short production pepper acceptance, the raw-query adapter, trusted-IP handling, custom response status, idempotency execution, and malformed route parameters. The schema verifier then failed with the missing rate-limit SQL routine, PUBLIC revoke, runtime grant, and rollback entry.

### Fixes

- Replaced the speculative raw query path with `rdb.rpc('consume_rate_limit_bucket', params)` and added the atomic SECURITY DEFINER PostgreSQL routine, revoke, runtime grant, rollback entry, and verifier mutation coverage.
- Added actual multi-value `set-cookie` output plus session/CSRF set and clear helpers.
- Added the reviewed policy paths, multi-bucket login limits, trusted CloudBase source-IP extraction, idempotency execution, query context, custom status responses, strict preflight validation, and malformed parameter handling.
- Hardened configuration and CSRF token validation; registered the public `/api/v1` gateway.
- Made all 5xx envelopes use a fixed safe message and added safe error-type diagnostics with HMAC-only actor logging.

### Verification

- Function tests: 27 passed.
- Schema verifier: passed.
- Full suite: 59 passed.
- Type check, secret scan, and whitespace check: passed.

## Fix round 2

Added method-scoped default rate limits with explicit metadata opt-out, corrected `app-api`-only deployment configuration, validated an explicit rate-limit pepper, and bound the CloudBase database handle to the configured schema. Added an idempotency-record table and a CloudBase RPC-backed store injection point for runtime deployment.
