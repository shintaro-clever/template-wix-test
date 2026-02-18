# Settings UI (Phase2-min)

This specification describes the minimal, docs-first contract for Integration Hub settings screens. It assumes Vault Option A (non-persistent secrets) and must stay in sync with:
- `docs/ai/core/phase2-integration-hub.md`
- `docs/ai/core/github-integration.md`
- `docs/schema.md`

## Role Matrix
| Screen | Owner | Member | Viewer |
| --- | --- | --- | --- |
| `/settings/integrations/github` | Full edit (create/update/disable/rotate/test) | View + `TEST_READONLY` | View only (tokenKeyRef may be partially masked); no test |
| `/settings/audit` | View | View | View-only (Phase2-min: read access allowed, no export) |

Notes:
- There is no export capability in Phase2-min for any role.
- “View” implies seeing all columns except secret material; Option A ensures no secrets exist in storage.

## Screen 1 — `/settings/integrations/github`
### Fields
| Field | Description | Validation |
| --- | --- | --- |
| `orgId` | Internal organization slug | Required; must match RBAC entry |
| `repo` | GitHub repo in `owner/repo` form | Required; must satisfy regex `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` and be unique per `(orgId, repo)` |
| `tokenKeyRef` | Logical Vault key reference (label only) | Required for CONNECT/ROTATE; treat as non-secret, displayable to all roles |
| `enabled` | Boolean toggle | Default `true`; owner can flip to disable |

### Role Behavior
- **Owner**: may create new rows, update `tokenKeyRef`, disable/enable, and run `TEST_READONLY`. Buttons are enabled.
- **Member**: read-only for fields but can press `TEST_READONLY` to verify API calls. The UI must annotate `tokenKeyRef` as “label only / not a secret”.
- **Viewer**: read-only. `tokenKeyRef` may be partially masked (e.g., show entire string or head/tail) since it is not secret, but label it clearly. `TEST_READONLY` button hidden/disabled.

### Validation Rules
1. `repo` must match the regex above.
2. `repo` uniqueness: reject duplicates per `(orgId, repo)` before saving.
3. `tokenKeyRef` cannot be empty; highlight that it is a label, not the PAT itself.
4. Owners must confirm disabling (modal with repo slug) before `enabled=false` persists.

### Audit Guarantees
Every action must call the backend API, which emits `audit_logs` entries per `docs/schema.md`:
- CONNECT → `action='INTEGRATION_CONNECTED'`.
- DISCONNECT → `action='INTEGRATION_DISCONNECTED'`.
- ROTATE → `action='SETTING_UPDATED'`, `metaJson.operation='rotate_token'`.
- TEST_READONLY → `action='SETTING_UPDATED'`, `metaJson.operation='test'`.

`metaJson` minimum keys: `operation`, `tokenKeyRef`, `actor_role`, `result`, plus optional context (HTTP status, repo, workflow_run_id). Never log secret values, PAT fragments, or raw API responses.

### TEST_READONLY Flow
1. Prompt owner/member for the current GitHub token (Option A manual input).
2. Run read-only GitHub API call (e.g., list PRs) using scopes `repo:status` or equivalent read scopes.
3. Show success/failure toast and record audit log (`operation='test'`).
4. No `.github/` files are modified; integration strictly observes.

## Screen 2 — `/settings/audit`
### Filters
- Time range (relative presets + custom).
- Action (enum values from `audit_action`).
- Repo (dropdown of configured repos).
- Actor (email/username).

### Role Behavior
- **Owner / Member**: may view filtered logs. Export is disabled in Phase2-min; show tooltip “Exports coming later”.
- **Viewer**: may view the same data (read-only) but cannot copy bulk data; disable export controls entirely.

### Data Model Mapping
- Columns mirror `audit_logs`:
  - Timestamp (`createdAt`).
  - Actor (`actorUserId` joined to users table).
  - Action (`audit_action`).
  - Target (`targetType`, `targetId`).
  - Details: render key/value pairs from `metaJson` (operation, tokenKeyRef, result, workflow_run_id, etc.).
- Apply masking to any field that might contain references to operator notes; never display secrets (per Option A, none should exist).
- Sample payloads: see `docs/settings/github-integration.sample.json`.

### Empty States / Errors
- If no data matches filters, show “No audit events yet” with link to `/settings/integrations/github` for onboarding.
- If the backend rejects a viewer (future policy), display access denied; for Phase2-min we allow viewer read access.

## References
- Governance + Vault policy: `docs/ai/core/phase2-integration-hub.md`
- GitHub integration lifecycle: `docs/ai/core/github-integration.md`
- Data model: `docs/schema.md`
