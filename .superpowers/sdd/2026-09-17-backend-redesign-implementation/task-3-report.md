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

### Atomic idempotency completion

#### RED

- Function/repository/schema tests initially failed in eight places: default-write replay executed twice, body changes did not conflict, invalid supported keys were ignored, actor scope was not passed to RPC, conflicts were not mapped to the public 409 envelope, sensitive responses were persisted verbatim, and the schema verifier accepted missing idempotency tables/RPC transitions.
- A second RED cycle proved the verifier also accepted a direct runtime table grant and a begin transition that inserted `completed` instead of `processing`.
- The full suite then exposed one secret-scanner failure caused by a non-placeholder API-key test fixture; changing it to an explicit `test-` placeholder resolved the fixture issue.

#### Implementation

- Reworked the three SECURITY DEFINER routines with a pinned search path. Begin now atomically inserts or reacquires only expired rows and distinguishes `acquired`, `completed`, `in_progress`, and `request_hash_conflict`; complete/fail require the exact processing identity and request hash.
- Added idempotency table constraints, RLS, PUBLIC revokes, exact runtime function grants, and matching rollback signature verification. The verifier now checks each transition's critical insert/update/delete/hash/expiry semantics and rejects direct table grants; mutation tests cover each branch.
- Added CloudBase RPC result validation and safe persisted response envelopes. Only status code, recursively filtered business body, and an explicit safe response-header allowlist are stored; cookie, authorization, token, and unsafe header fields are removed.
- Added pre-handler actor resolution and HMAC actor/IP scoping. Write routes support idempotency by default when a key is present, `required` forces it, and `none` bypasses it. Canonical method, actual path, route parameters/template, sorted query, actor scope, and body hashing prevent cross-actor/path/query replay while preserving body-change conflicts.
- Added fake-store/RPC coverage for replay, actor/path/query isolation, retry after failure, missing trusted identity, key validation, safe persistence, and runtime dependency injection.

#### Verification

- Function tests: `npm test -- --run cloudbase/functions/app-api/test` — 2 files, 40 tests passed.
- Schema verifier: `npm run verify:backend-schema` — passed.
- Full suite: `npm test -- --run` — 6 files, 73 tests passed.
- Type check: `npm run lint` — passed.
- Secret scan: `npm run verify:secrets` — no findings.
- Whitespace check: `git diff --check` — passed.

#### Remaining deployment check

The SQL behavior is covered by static semantic and mutation verification; a staging PostgreSQL apply/concurrency run remains a deployment checkpoint because no database service is available in this worktree.

## Fix round 3

### RED

- The rate-limit verifier rejected the corrected `current_bucket.hit_count + 1` alias and accepted the invalid target-table reference.
- Sensitive-response tests showed nested recovery codes/tokens/passwords/secrets, signed URLs, signed query strings, Bearer values, cookie/authorization headers, and primitive strings were sent to `complete_idempotent_request`; `location` was also persisted.
- Fail-release tests showed `{ error }` and `false` RPC results were ignored and the original operation error was rethrown even when the processing record remained leased.
- Session actor tests failed because no CloudBase actor resolver existed and the production runtime still used an always-null resolver.
- Schema mutation tests showed no controlled active-session resolver, a 24-hour processing lease, and no separate 24-hour completed replay retention.
- Malformed begin RPC rows/states initially surfaced as generic 500 errors rather than safe dependency failures.

### Implementation

- Corrected the rate-limit upsert to increment through its `current_bucket` alias and added a regression mutation that restores the invalid table-qualified expression.
- Replaced sensitive-field stripping with a reject-and-release persistence guard. Only `content-type`, `etag`, and `cache-control` response headers are eligible; `location` and all other headers are discarded. Any nested credential field, signed URL/query, Bearer value, cookie/authorization header, or primitive string response releases the processing record, skips completion, returns the original one-time result, and emits only a fixed error type/code security event.
- Added safe `DependencyUnavailableError` mapping with sanitized cause types. Begin/complete/fail protocol errors and false affected results now produce safe 503 responses; a successful fail still rethrows the original operation error.
- Added `resolve_user_session(text)` as a pinned-search-path SECURITY DEFINER RPC that returns only active user id/role for a non-revoked, unexpired session. PUBLIC revoke, runtime grant, rollback, semantic verification, and mutation coverage use the exact signature.
- Added `createCloudBaseActorResolver`: absent/low-entropy cookies return null, valid session tokens are HMAC-SHA256 hashed before RPC, and the production runtime injects the resolver before rate limiting, idempotency, and request logging.
- Reduced processing leases to five minutes; successful completion extends replay retention to 24 hours. Auth recovery/login/register and signed-access route modules are explicitly documented to use `idempotency: 'none'` in Tasks 4 and 6.

### Verification

- Function tests: `npm test -- --run cloudbase/functions/app-api/test` — 2 files, 59 tests passed.
- Schema verifier: `npm run verify:backend-schema` — passed.
- Full suite: `npm test -- --run` — 6 files, 95 tests passed.
- Type check: `npm run lint` — passed.
- Secret scan: `npm run verify:secrets` — no findings.
- Whitespace check: `git diff --check` — passed.

### Remaining deployment check

Static SQL semantics and mutation tests cover the reviewed paths; staging PostgreSQL apply and concurrent lease/reacquisition testing remain deployment checkpoints because no database service is available in this worktree.
