# Vault Provider (GitHub Token Only)

## Purpose
- Fix the boundary where Integration Hub workflows touch secrets when only GitHub-issued tokens are available.
- Prevent leakage by default; every operation routes through this provider that enforces policy + audit.
- Linked policy source: `docs/ai/core/phase2-integration-hub.md` (RBAC + audit decisions).

## Interface
TypeScript-style definition (language-agnostic):
```ts
export interface VaultProvider {
  setSecret(scope: OrgScope, key: string, value: string): Promise<SetSecretResult>;
  getSecret(scope: OrgScope, key: string): Promise<GetSecretResult>;
  deleteSecret(scope: OrgScope, key: string): Promise<DeleteSecretResult>;
}

type OrgScope = { orgId: string };
```
### Contract
- `scope.orgId` selects the Vault path (`integration-hub/<orgId>/<env>/<key>` or equivalent).
- `key` is normalized lowercase kebab-case; enforcement lives in the provider to avoid state drift.
- `value` never logs nor returns in plaintext once stored.
- All methods must succeed idempotently (repeat calls safe).
- Scope is strictly org-level; cross-org secrets require distinct `scope` objects.

## Vault Policy Options
### Option A — Recommended (Phase2 default)
- Secrets are **not** persisted centrally. `setSecret` stores masks only long enough to validate shape, then discards.
- `getSecret` returns `{ status: 'missing', prompt: 'Enter token in CLI/UI' }` forcing per-run input.
- Use when handling GitHub personal access tokens or other high-sensitivity credentials during rollout.
- This is the only allowed mode during Issue #21 / Phase2. Any persistence request MUST fail closed with a warning.

### Option B — Encrypted Storage (Future)
- Provider encrypts values client-side (libsodium sealed boxes) before sending to storage (S3, KV, etc.).
- Requires KMS strategy + envelope key rotation spec (Phase2-min TBD).
- Until B ships, calling `setSecret` should explicitly log "unsupported" if persistent flag is requested.
- Deferred until Phase2+; update the Phase2 memo and schema enums before enabling.

## Logging & Audit (DoD)
- Provider never writes the raw `value` to stdout/stderr/log files.
  - All structured logs redact tokens via `mask(value)` → e.g., `abcd…wxyz` (first/last 2 chars only).
  - Failures emit generic messages (`"failed to store secret for org <orgId>"`).
- Every invocation produces an `audit_logs` row (action = `VAULT_ACCESS` as defined in `docs/schema.md`).
  - `metaJson` fields:
    - `operation`: `set`, `get`, or `delete`.
    - `key`: hashed identifier (SHA-256 base64) instead of plaintext key.
    - `scope`: `{ orgId }`.
    - `result`: `success | not_found | unsupported | failed`.
  - `action='VAULT_ACCESS'`, `targetType='vault_secret'`, `targetId='<orgId>::<keyHash>'`.
  - `setSecret`/`deleteSecret` operations count as **設定変更** for compliance; dashboard surfaces via `operation`.
- Reads (`getSecret`) log as `operation: get` with `result: missing` when Option A returns prompt, satisfying the audit trail without storing the secret.

## Usage From Workflows
1. Resolve orgId from repo metadata.
2. Instantiate provider with GitHub App token (fine-grained PAT not stored, only used in-memory).
3. Call API and handle responses:
   - `setSecret`: only allowed for Owners; require Decision URL for `metaJson.justification`.
   - `getSecret`: Members allowed if RBAC grants `VAULT_ACCESS`. For Option A, expect `status: missing` and trigger UI prompt.
   - `deleteSecret`: Owners only; require confirmation string (e.g., org slug) to avoid accidents.
4. Emit audit event ID back to caller for reconciliation.

## Masking Helper (Pseudo)
```ts
const mask = (value: string) => {
  if (!value) return '';
  const head = value.slice(0, 2);
  const tail = value.slice(-2);
  return `${head}…${tail}`;
};
```
- Provider MUST use this (or stricter) mask before constructing any log/error; never reveal more than the first/last two characters.

## Integration Notes
- Bindings live under `.github/access/vault-provider.ts` (or equivalent library) and are imported by Actions/CLI.
- Unit tests must assert:
  - `setSecret` writes audit log with `operation: set` and masked value.
  - `getSecret` never logs raw tokens and returns `status: 'missing'` under Option A.
  - `deleteSecret` writes `operation: delete` audit record.
- Reference: `docs/ai/core/phase2-integration-hub.md` for policy; `docs/schema.md` for enum definitions.
