# GitHub Integration (Phase2-min Read-Only)

## Purpose
- Provide a lightweight way to manage GitHub integration configuration + audit + read-only verification without touching `.github/` files or writing back to GitHub.
- Ensure every configuration change produces an audit trail (see `docs/schema.md`).
- Run verification calls using Option A tokens entered per run; never grant write scopes.
- Source-of-truth alignment: follow `docs/ai/core/phase2-integration-hub.md` for the surrounding RBAC/Vault policy.

## Configuration Fields (per org)
| Field | Description | Notes |
| --- | --- | --- |
| `orgId` | Internal Integration Hub org identifier | Matches RBAC records |
| `repo` | GitHub repository slug `owner/repo` | Stored in `github_integrations.repo` |
| `tokenKeyRef` | Logical reference to the Vault key used at runtime | Not a secret; Option A requires users to paste tokens every run |
| `enabled` | Boolean flag to allow pausing sync without deleting config | Default `true` |

- Records are unique per `(orgId, repo)`; duplicates must be rejected.
- `tokenKeyRef` maps to whatever label the operator uses when calling the Vault provider; it is safe to store because no token value is persisted under Option A.

## Lifecycle & Audit Mapping
All actions are read-only on GitHub itself. Each step logs to `audit_logs` using the enum values defined in `docs/schema.md`.

### CONNECT
1. Owner supplies `orgId`, `repo`, `tokenKeyRef`, `enabled=true`.
2. Integration Hub stores/updates the row.
3. Audit: `action='INTEGRATION_CONNECTED'`, `targetType='github_repo'`, `targetId='<orgId>::<repo>'`, `metaJson.operation='connect'`.

### DISCONNECT
1. Owner toggles `enabled=false`.
2. Audit: `action='INTEGRATION_DISCONNECTED'`, `metaJson.operation='disconnect'`.

### ROTATE
1. Owner updates `tokenKeyRef` to point to a new Vault label (e.g., after PAT rotation).
2. Audit: `action='SETTING_UPDATED'`, `metaJson.operation='rotate_token'`, include both old/new logical refs.

### TEST_READONLY
1. Owner/member runs a verification call (e.g., list open PRs) using Option A token input.
2. No GitHub writes occur.
3. Audit: `action='SETTING_UPDATED'`, `metaJson.operation='test'`, include API name + status.

## metaJson Minimum Fields
Every audit event should include at least:
- `operation` — `connect | disconnect | rotate_token | test` (exact values above).
- `tokenKeyRef` — logical reference only (never the token value).
- `actor_role` — owner/member triggering the action (snake_case to match future queries).
- `result` — `success | failed`.
- Optional debugging info (HTTP status, workflow_run_id) is allowed, but **never** log secrets, PAT fragments, or request payloads.

## Option A Behavior
- Secrets are entered manually whenever a workflow/Test runs; Integration Hub never stores PATs, GitHub App keys, or refresh tokens.
- `tokenKeyRef` is purely a label to remind operators which secret to input; rotating tokens means updating this label plus any external password manager, not the database value itself.
- Vault provider interactions must comply with `docs/ai/core/vault-provider.md`: mask all logging, emit `VAULT_ACCESS`, and fail closed if someone requests persistence.

## Non-goals
- No `.github/` workflow edits or automation toggles.
- No write operations against GitHub (issues, PRs, statuses, etc.).
- No Figma / Google integrations; those stay outside this scope.

## Checklist (CONNECT example)
- [ ] Ensure repo follows canonical PR Gate template (Phase1 baseline).
- [ ] Capture `tokenKeyRef` in a secure operator checklist (not in the database).
- [ ] Insert/update the `github_integrations` row with `enabled=true`.
- [ ] Confirm the `INTEGRATION_CONNECTED` audit entry exists with correct metaJson.
- [ ] Run `TEST_READONLY` (list PRs) and record the audit entry with `operation='test'`.

Refer back to `docs/ai/core/phase2-integration-hub.md` for governance and to `docs/schema.md` for the exact column/types referenced above.
