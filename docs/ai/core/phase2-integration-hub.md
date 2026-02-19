# Integration Hub Phase2 Design Memo

## Purpose / Scope
- Phase1 (v0.5) ship—the job spec (`src/jobSpec.js`), runner stub (`scripts/runner-stub.js`), UI (`hub/index.html`), and evidence path (`.ai-runs/<run_id>/artifact.txt`)—is now the source of truth (SoT). Phase2 extends this exact contract rather than inventing a new one.
- Phase2 moves from observe-only gating to enforced operations across the Integration Hub owned repos while remaining backward-compatible with the Phase1 contract.
- All requirements here update the source of truth for how automation, secrets, and access control must behave starting Phase2 cutover.
- Implementations outside `.github/` or docs remain unchanged; engineering teams must adapt to these guardrails.

### Phase1 Contract Anchors (must remain stable)
- **Job Spec**: Required fields (`job_type`, `goal`, `inputs`, `constraints`, `acceptance_criteria`, `provenance`, `run_mode`, `expected_artifacts`) as defined in `src/jobSpec.js`. Phase2 services must ingest the same schema and may only extend via optional fields.
- **Runner Result**: `{ status: 'ok' | 'error', artifacts, diff_summary, checks, logs, provenance }` shape. Phase2 runners can append data but cannot change the meaning of existing keys.
- **Hub Surface / API**: `/api/validate` and `/api/run` endpoints (plus the static UI in `hub/index.html`) are the minimal integration points. Future services should proxy/augment these endpoints rather than bypassing them.
- **Evidence Location**: `.ai-runs/<run_id>/artifact.txt` acts as the human-auditable record in Phase1. Phase2 may mirror or migrate artifacts into Vault/object storage, but the CLI/UI must still expose a traceable artifact path per run.

### Out-of-Scope for this PR
- This document does **not** implement RBAC/Vault/Audit services; it only codifies how Phase2 will plug into the existing Phase1 contract.
- Actual service code, database migrations, secret storage, or workflow enforcement remain Phase2 deliverables tracked separately.

## RBAC Model (Owner / Member / Viewer)
### Owner
- Privileges: assign org roles, approve vault policy changes, access audit dashboards.
- Restrictions: cannot disable audit sinks without security approval; all deviations must be logged in Issue #21.

### Member
- Privileges: create/edit Issues, branches, PRs; trigger workflows that prompt for fresh tokens (Option A); log Decisions.
- Restrictions: cannot edit RBAC assignments, cannot change vault policy, cannot bypass Gate failures except via documented Decision logged + owner approval; no stored secret reads exist under Option A.

### Viewer
- Privileges: read Issues/PRs/Docs, comment on Issues, download artifacts explicitly shared to readers.
- Restrictions: no push/merge rights, Vault access denied, cannot trigger workflows that modify resources, comments auto-tagged `viewer` for audit clarity.

## RBAC Access Matrix (Phase2)
| Role | View Integration Settings | Edit Integration Settings | View Audit Logs |
| --- | --- | --- | --- |
| Owner | ✅ | ✅ | ✅ |
| Member | ✅ | ❌ | ✅ |
| Viewer | ✅ (token refs masked) | ❌ | ✅ (read-only, no export) |

- Enforcement is done in the settings UI/API layer; server refuses write attempts from members/viewers with HTTP 403.
- Masking ensures viewers never see stored Vault references in full.


## Vault Policy — Option A (Selected)
- Option A = non-persistent handling. Secrets are entered per run (CLI/UI) and never stored in Vault or any central data store.
- Status: **Phase2 adopts Option A.**
- Reasoning: keeps GitHub tokens out of rest storage while Phase2-min ships without a hardened KMS story.
- Mechanics:
  - `setSecret` only validates structure, writes audit records, and discards the plaintext immediately (see `docs/ai/core/vault-provider.md`).
  - `getSecret` always returns `status: 'missing'` + user prompt so operators must paste tokens at execution time.
  - `deleteSecret` is a logical remove (audit-only) because nothing is saved; use it to note revocations in audit logs.
- Appendix (for future consideration): Option B handles encrypted persistence once KMS + rotation decisions are complete.
- Option B（encrypted persistence with libsodium/KMS） is deferred until Phase2+; document decisions in Issue #21 before implementation.

### Option B Preview (Phase2+)
- Secrets stored under path `integration-hub/<repo>/<env>/<purpose>` inside an org-scoped Vault namespace.
- Access granted via GitHub OIDC role bindings that map RBAC role → Vault policy.
- Members receive read-only capability on paths the owner lists in `vault-access.yml`; owners have read/write.
- Viewers receive no capability; all secret references in docs must point to sanitized env vars.
- Do not enable until Option A is replaced via a formal Decision + updated schema/audit plan.

## Audit Log Specification
All events must be written to an auditable sink (data store TBD for Phase2); the interface below defines the required payload regardless of implementation.

| Event Type | Trigger | Stored Fields |
| --- | --- | --- |
| `role_change` | Owner promotes/demotes a user | `event_id`, `timestamp_utc`, `actor`, `target_user`, `role_before`, `role_after`, `justification_issue_url`, `checksum` |
| `vault_access` | Any Vault token read/write via GitHub workflow or CLI | `event_id`, `timestamp_utc`, `actor`, `repo`, `env`, `path`, `operation` (read/write), `workflow_run_id`, `status`, `ip_hash` |
| `gate_override` | Gate marked passed despite failure | `event_id`, `timestamp_utc`, `actor`, `pr_number`, `issue_number`, `failure_reason`, `decision_comment_url`, `approver`, `expiry` |
| `decision_logged` | Decision section updated on Issue | `event_id`, `timestamp_utc`, `actor`, `issue_number`, `decision_hash`, `linked_figma_url`, `linked_pr`, `diff_summary` |
| `github_integration` | Connect/disable/rotate GitHub repo enrollment | `event_id`, `timestamp_utc`, `actor`, `org_id`, `github_repo`, `operation`, `token_ref`, `target_audit_id` |

### Retention / Access
- Retain audit events for 400 days minimum; cold storage beyond 400d optional but recommended.
- Owners have query access; members receive read-only dashboards; viewers receive no audit access.
- Any missing audit write is treated as Sev2 until root caused and backfilled.

## Vault Interface
- GitHub token-only provider contract lives in `docs/ai/core/vault-provider.md`.
- Option A (no persistence) is mandatory until libsodium/KMS design lands; Option B remains TODO.
- Provider must mask tokens in all logs and emit audit `VAULT_ACCESS` events for set/get/delete.

## Evidence (Issue #21 / PR Gate)
- PR: https://github.com/shintaro-clver/figma-ai-github-workflow/pull/20
- Actions Run: https://github.com/shintaro-clver/figma-ai-github-workflow/actions/runs/22140619772

## Implementation Notes
- Phase1 UI/server (`hub/index.html`, `/api/validate`, `/api/run`) stays authoritative for contract testing; Phase2 services should proxy these endpoints or supply drop-in replacements using the same request/response shapes.
- MCP runner bridge (see `docs/ai/core/mcp-runner.md`) defines how CLI-based connectors plug into `/api/run` via `run_mode: 'mcp'`.
- RBAC + Vault mappings ship as code under `.github/access/` (tracked separately) with required reviews by both owners.
- GitHub read-only integration onboarding flow: `docs/ai/core/github-integration.md`.
- Settings UI contract (integrations/audit screens): `docs/ai/core/settings-ui.md`.
- Migration checklist: assign roles, populate `vault-access.yml`, run dry-run of audit emitters, then turn on Gate enforcement flag.
- All downstream squads must reference this memo from `docs/ai/core/workflow.md` to make the SoT chain explicit.

## Phase2-later / Governance (Informational)
- **`.github` automation ownership**: Owners can extend/modify workflows only after Phase2 stabilizes; document every change in Issue #21.
- **Gate enforcement levels**: flipping PR Gate from observe → enforce requires a governance review and is out-of-scope for Phase2-min.
- **Owner cap**: keep a maximum of two active owners per product area to avoid approval ambiguity; revisit post-Phase2.
- **Self-merge rule**: Owners must continue seeking an additional reviewer before merging their own PRs, even when governance tightens later.
