# Security rotation runbook

The repository previously contained a hard-coded administrator credential in remote admin verification and screenshot scripts. The value has been removed from the current worktree, but it must be treated as compromised.

## Immediate actions

1. Rotate `ADMIN_PASSWORD` in the deployed admin service immediately. Do not reuse the former value.
2. Revoke existing administrator tokens and sessions, including any issued by the affected service.
3. Check CloudBase, Vercel, and COS access and deployment logs for unexpected authentication, uploads, metadata changes, or downloads. Preserve relevant evidence and escalate anomalies.
4. Store the replacement only in the appropriate secret manager or local untracked environment; use `ADMIN_TEST_PASSWORD` only when intentionally running the remote checks.

## Git history note

Removing the credential from the current files does not remove it from Git history, existing clones, CI logs, caches, or other artifacts. Rewriting public history is a separate decision that requires coordination with all collaborators and downstream consumers. No history rewrite is performed by this task.

Run `npm run verify:secrets` before committing changes that touch authentication or admin tooling.
