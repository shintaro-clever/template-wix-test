# Integration Hub Data Model

Purpose: anchor RBAC + audit persistence for Phase2 rollout until an actual service schema exists. All column types assume PostgreSQL-compatible syntax; adjust as needed when porting.

Secrets are never stored in plaintext inside these tables; any credentials are referenced by Vault key names only (see `tokenKeyRef`).

## users
| column    | type        | constraints                    | notes |
|-----------|-------------|--------------------------------|-------|
| id        | uuid        | primary key                    | stable user identifier |
| email     | citext      | unique, not null               | used for login + mapping to GitHub handle |
| name      | text        | not null                       | display name |
| createdAt | timestamptz | default now(), not null        | audit trail |

## orgs
| column    | type        | constraints                    | notes |
|-----------|-------------|--------------------------------|-------|
| id        | uuid        | primary key                    | org identifier |
| name      | text        | unique, not null               | org display name |
| createdAt | timestamptz | default now(), not null        | provisioning timestamp |

## memberships
| column    | type            | constraints                                                 | notes |
|-----------|-----------------|-------------------------------------------------------------|-------|
| userId    | uuid            | references users(id) on delete cascade, part of primary key | |
| orgId     | uuid            | references orgs(id) on delete cascade, part of primary key  | |
| role      | membership_role | not null                                                    | enum defined below |
| createdAt | timestamptz     | default now(), not null                                     | |

### membership_role enum
```sql
CREATE TYPE membership_role AS ENUM ('owner', 'member', 'viewer');
```
- Owners: manage automation, vault policy, RBAC assignments.
- Members: build + operate, handle on-demand token prompts (no stored secrets under Option A).
- Viewers: read-only, no secrets/workflow triggers.

## audit_logs
| column       | type        | constraints                                     | notes |
|--------------|-------------|-------------------------------------------------|-------|
| id           | bigserial   | primary key                                     | |
| orgId        | uuid        | references orgs(id) on delete cascade, not null | partition/filter per org |
| actorUserId  | uuid        | references users(id), not null                  | who performed the action |
| action       | audit_action | not null                                      | enum defined below |
| targetType   | text        | not null                                        | e.g., `user`, `vault_secret`, `pr` |
| targetId     | text        | not null                                        | opaque identifier (Issue #, secret path, etc.) |
| metaJson     | jsonb       | not null default '{}'::jsonb                    | structured payload (see memo) |
| createdAt    | timestamptz | default now(), not null                          | write timestamp |

### audit_action enum
```sql
CREATE TYPE audit_action AS ENUM (
  'SETTING_UPDATED',
  'INTEGRATION_CONNECTED',
  'INTEGRATION_DISCONNECTED',
  'EXPORT_CREATED',
  'VAULT_ACCESS'
);
```
- Enum values are fixed; add new actions only via Issue #21-level decisions.
- Use `SETTING_UPDATED` for schema/role/protection toggles, integration events for repo onboarding state changes, `EXPORT_CREATED` when audit exports are generated, and `VAULT_ACCESS` for Vault provider calls.

## Indexing / Notes
- `memberships`: composite primary key `(orgId, userId)` ensures 1 row per user/org, supporting fast role lookups.
- `audit_logs`: index `(orgId, createdAt desc)` plus per-action partials for dashboards.
- Store all enum definitions in migrations so other services can reference them as foreign keys/constraints.
- Keep `metaJson` small; include `workflow_run_id`, `ip_hash`, `decision_comment_url`, etc., exactly as defined in `docs/ai/core/phase2-integration-hub.md`.

## github_integrations
| column      | type        | constraints                                                   | notes |
|-------------|-------------|---------------------------------------------------------------|-------|
| id          | uuid        | primary key                                                   | integration record ID |
| orgId       | uuid        | references orgs(id) on delete cascade, not null               | org scope |
| repo        | text        | not null                                                      | stored as `owner/repo` |
| tokenKeyRef | text        | not null                                                      | reference to Vault key (no secret stored) |
| enabled     | boolean     | default true, not null                                        | toggles sync |
| createdAt   | timestamptz | default now(), not null                                       | |
| updatedAt   | timestamptz | default now(), not null                                       | managed via trigger |

- Repo configuration is unique per `(orgId, repo)`; enforce with a unique index.
- `tokenKeyRef` must correspond to a Vault key per Option A provider; storing plaintext tokens is prohibited anywhere in this table or logs.
- Changes (connect/disable/rotate) emit `audit_logs` entries with `action='INTEGRATION_CONNECTED'`, `INTEGRATION_DISCONNECTED`, or `SETTING_UPDATED` as appropriate.
