# MCP Runner Interface (Phase2 Bridge)

## P0-04 Operational SoT (VPS Single-Node E2E)
- `RUNNER_MODE=inline` is the only supported entrypoint for VPS-local end-to-end execution of `/api/runs` (`queued -> running -> completed/failed`) without external worker infrastructure.
- Required env:
  - `JWT_SECRET` (if missing/invalid, `/api/auth/login` fails and API auth flow cannot run).
- Recommended env:
  - `RUNNER_MODE=inline` (enables the inline queue worker on API server startup).
- Secret policy:
  - Do not record secret values in docs/logs/issues/PRs. Record only presence/length when needed.

### P0-06 API Contract (Fixed)
- Login payload for `POST /api/auth/login` is fixed to `{ "id": "...", "password": "..." }`.
- `username` is not a valid login field for this API contract.
- Run create (`POST /api/runs`) requires `target_path` at the top level (in addition to `inputs.target_path` if used by the job).
- Run status tracking is done via `GET /api/runs` list polling and matching `run_id` (no per-run `GET /api/runs/:id` contract).
- `queued` runs are actually executed only when the API server starts with `RUNNER_MODE=inline`; this is the path that produces `.ai-runs/<run_id>/...` artifacts.
- `JWT_SECRET` is mandatory for auth flow; without a valid value, login may fail.
- Supported `job_type` via `/api/runs` (VPS inline runner): `integration_hub.phase1.code_to_figma_from_url` only.
- Any other `job_type` fails with `unsupported_job_type:<job_type>` and produces `.ai-runs/<run_id>/inline_runner_error.json`.
- Phase2 smoke jobs (e.g., `integration_hub.phase2.mcp.offline_smoke`) are not supported via `/api/runs` in the current VPS inline runner. Use CLI (`node scripts/run-job.js --job ...`) for Phase2 smoke validations.

### Minimal Execution Example (Auth + Run + Artifacts)
```bash
BASE="http://127.0.0.1:3001"

# 1) login (id/password must match seeded user; do not print secrets)
curl -sS -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"id":"<user-id>","password":"<password>"}' \
  | tee /tmp/login.json
TOKEN=$(node -e "const j=require('/tmp/login.json'); console.log(j.token||j.jwt||j.access_token||'')")
echo "TOKEN_LEN=${#TOKEN}"

# 2) enqueue Phase1 local_stub run
curl -sS -X POST "$BASE/api/runs" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"job_type":"integration_hub.phase1.code_to_figma_from_url","run_mode":"mcp","target_path":"vault/tmp","inputs":{"mcp_provider":"local_stub","page_url":"https://example.com"}}' \
  | tee /tmp/run_create.json

# 3) poll runs list until completed/failed
RID=$(node -e "const t=require('fs').readFileSync('/tmp/run_create.json','utf8'); const m=t.match(/\"run_id\":\"([^\"]+)\"/); console.log(m?m[1]:'')")
for i in {1..30}; do
  curl -sS "$BASE/api/runs" -H "authorization: Bearer $TOKEN" | tee /tmp/runs_list.json >/dev/null
  node -e "const rid=process.argv[1]; const rows=require('/tmp/runs_list.json'); const r=Array.isArray(rows)?rows.find(x=>x.run_id===rid):null; console.log(r?r.status:'missing'); if(r&&['completed','failed'].includes(r.status)) process.exit(0); process.exit(1);" "$RID" && break
  sleep 1
done

# 4) artifacts
ls -la ".ai-runs/$RID" || true
sed -n '1,160p' ".ai-runs/$RID/summary.md" 2>/dev/null || true
```

## Purpose
- Provide a transport-agnostic adapter so Phase1 local stubs and future MCP/real integrations share the same job contract.
- Allow the Phase1 Hub (`/api/run`) to invoke MCP-compatible runners via a CLI command while preserving the `runnerResult` schema.

## Inputs (Job Payload Additions)
`run_mode` itself is limited to `"local_stub"` or `"mcp"`. The content below only applies to the `"mcp"` branch; `"local_stub"` continues to execute via `scripts/runner-stub.js`.

When `run_mode` is `"mcp"`, the hub inspects `job.inputs` to route through the adapter. All MCP jobs must keep the standard Phase1 fields (`message`, `target_path`, etc.) and add the provider metadata below.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `mcp_provider` | enum (`"module"`, `"spawn"`, `"claude_code"`) | Optional (defaults to `"module"`) | Chooses how the adapter executes the MCP runner. |
| `timeout_ms` | number | Optional | Global timeout fallback for spawn-based runners (default `60000`). |
| `claude` | object | Required when `mcp_provider="claude_code"` | Contains Claude Code launch details (`command`, optional `args`, `timeout_ms`, `env_allowlist`). |
| `mcp_module` | string | Required when `mcp_provider="module"` | Local JS entry point exporting `run(job)` (or equivalent node script). |
| `mcp_command` | string | Required when `mcp_provider="spawn"` | CLI command to spawn (e.g., `"node"`, `"npx @codex-ai/cli mcp"`). |
| `mcp_args` | string[] | Required when `mcp_provider="spawn"` | Arguments passed to `mcp_command`. |
| `mcp_servers` | object[] | Optional | Claude Code MCP server declarations (`{ name, command, args?, env_allowlist? }`). |

### Provider-specific Inputs

- **module**: Supply `mcp_module` (or a node script path); adapter loads the module directly.
- **spawn**: Supply both `mcp_command` and `mcp_args`; adapter spawns the binary and streams JSON over stdio.
- **claude_code**: Provide a `claude` object with at least `command` plus optional `args`, `timeout_ms`, and `env_allowlist`. Optional `mcp_servers` describe the Claude Code MCP servers (Figma, GitHub, etc.) that should be started.

### Runner Domain Inputs

| Runner | Required Inputs |
| --- | --- |
| GitHub Repo Metadata | `github_repo` (owner/repo), optional `github_token_env` (defaults to `GITHUB_TOKEN`). |
| Figma File Metadata | `figma_file_key` or `figma_file_url`, `figma_token_env` (defaults to `FIGMA_TOKEN`). |

## Execution Contract
- **stdin**: The job JSON (stringified) is written once; MCP runners should parse it entirely before acting.
- **stdout**: The MCP runner must emit exactly one JSON object that conforms to the Phase1 runner result contract (`status`, `artifacts`, `checks`, `logs`, `provenance`, `evidence_paths`, `audit_paths`).
- **stderr**: Forwarded into the adapter logs for observability (trimmed if necessary).

## Failure Handling
- If the process exits with a non-zero code, times out, or emits invalid JSON, the adapter returns `status: "error"` and appends a check item `{ id: 'mcp_exec', ok: false, reason: '<details>' }`.
- The response logs include stderr snippets or adapter messages so operators can debug without digging into raw MCP output.
- `cli_presence` fires earlier during preflight when the requested Claude CLI binary cannot be resolved, so fix PATH/installation issues before retrying.
- `mcp_exec` means the CLI launched but the MCP flow failed mid-run (non-zero exit, timeout, invalid JSON, etc.), so triage via the returned reason/logs.

## Evidence
- MCP runners are responsible for writing artifacts/audit logs (e.g., to `.ai-runs/<run_id>/…`) before emitting the final JSON. The adapter does not mutate the payload beyond wrapping errors.
- Phase2 Vault/Audit systems can consume MCP-produced evidence the same way they handle local-stub outputs, since the `runnerResult` shape remains identical.

### Offline Smoke First
- まず offline smoke（local_stub）を実行して、run.json/audit.jsonl の生成と Gate/Triage 表示が成立することを確認する。
- Always execute `node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator` before attempting any network/Claude CLI job. This verifies the MCP adapter path, run.json/audit.jsonl emission, and the ability to materialize `.ai-runs/<run_id>/claude_mcp_smoketest.json` without relying on external binaries.
- Offline smoke **success** produces `.ai-runs/<run_id>/run.json`, `.ai-runs/<run_id>/audit.jsonl`, and `.ai-runs/<run_id>/claude_mcp_smoketest.json`. The artifact contains the stubbed handshake payload; use it as a baseline when comparing later Claude runs.
- Offline smoke **failure** still produces `run.json` / `audit.jsonl`. Triage via `runnerResult.checks_summary`, `checks` (look for `{ id: "mcp_exec", ok: false, reason: "<details>" }`), and `logs`. The absence of `claude_mcp_smoketest.json` is expected in this case—do not treat it as a separate error.

## Claude Code Smoke Test Job
- `scripts/sample-job.claude.smoke.json` is the canonical payload for validating the `claude_code` provider without relying on CI/network mocks. It keeps `run_mode: "mcp"`, selects `inputs.mcp_provider: "claude_code"`, and pins the target artifact to `.ai-runs/{{run_id}}/claude_mcp_smoketest.json` so the Hub can diff real Claude Code handshakes.
- Preconditions: install the Claude Code CLI (the sample uses `claude code --stdio` but you may point `inputs.claude.command/args` at your local binary), make sure the referenced MCP servers (GitHub/Figma runners in this repo or your own) are reachable, and export any tokens listed in the `env_allowlist` entries.
- Manual run: `node scripts/run-job.js --job scripts/sample-job.claude.smoke.json --role operator`.
- Expected evidence:
  - **Success**: `.ai-runs/<run_id>/claude_mcp_smoketest.json` is emitted together with `run.json` / `audit.jsonl`, and the artifact captures the Claude handshake metadata for the connected MCP servers.
  - **Failure** (CLI not installed, rejected servers, timeout, etc.): `run.json` / `audit.jsonl` still land under `.ai-runs/<run_id>/` with `status: "error"` plus a `checks` entry `{ id: "mcp_exec", ok: false, reason: "<stderr>" }`, but `claude_mcp_smoketest.json` might not exist. Use `run.json.checks` / `run.json.logs` to pinpoint the failing component, and correlate with `audit.jsonl` entries (RUN_START/RUN_END + checks_summary) when raising incidents.
