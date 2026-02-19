# figma-ai-github-workflow

Integration Hub で **プロジェクト（リポジトリ）を量産**するときに使う  
**標準テンプレート（運用レール / ガードレール / SoT）**です。

このリポジトリは、各プロジェクトで **Figma × AI × GitHub** を「壊れない運用」で回すための
**共通ルールとCIゲート**を提供します。

---

## 何が入っているか（このテンプレが配布するもの）
- Issue Form Template（AI Bootstrap）
- PR Template
- PR Gate（GitHub Actions）
- 運用SoT（workflow / decision policy / Phase2-min specs などの docs）

---

## 目的（Goal）
- Issue → PR → Decision を短時間でトレース可能にする
- “会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）
- テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

---

## Canonical Workflow（正規ルート）
1. Issue作成（AI Bootstrapフォーム）
2. ブランチ作成（例: `issue-<number>-<slug>`）
3. 実装 → コミット
4. PR作成（PRテンプレ使用）
5. PR Gate が緑 → Merge
6. Decision（必要なら Issue コメントに残す）

---

## Rules（必須）
### Issue（案件のSoT）
- Figma URL / Default AI / AI thread URL(s) / Acceptance Criteria を必須入力

### PR（実装単位）
- `Fixes #<issue>` 必須
- AC（チェック済み）が最低1つ必須（PR Gateで検証）

---

## Included
- Issue Form Template: `.github/ISSUE_TEMPLATE/ai-bootstrap.yml`
- PR Template: `.github/PULL_REQUEST_TEMPLATE.md`
- PR Gate (Actions): `.github/workflows/pr-gate.yml`
- Docs (SoT): `docs/`

---

## ⚠️ 注意（このテンプレが提供しないもの）
- Integration Hub 本体（RBAC/Audit/UI/APIなどのサービス実装）
- 各プロジェクト固有のプロダクト実装コード

---

## Next Steps（運用開始）
1. このテンプレから新規リポジトリを作成（GitHub Template機能）
2. 必要なら Branch protection で status check を required に設定
3. 以後は Issue → PR → Gate の正規ルート以外を使わない

## 📚 Docs（一次情報）
- 正規ルートと運用ルール: `docs/ai/core/workflow.md`
- Decisionの残し方: `docs/ai/core/decision-policy.md`

---

## 🚀 Current Status（いま出来ていること）
- PR Gate（Actions）：PR本文の必須要素チェック（Issue参照 / Figma / ACチェック）
- Issue Form：Figma URL / AI thread URL(s) / Acceptance Criteria の入力

---

## Phase1 Integration Hub Stub
- `npm test` — validates the sample job JSON and ensures the runner-stub writes an artifact under `.ai-runs/`.
- `node scripts/run-job.js --job scripts/sample-job.json --role operator` — executes any job (local stub by default, MCP if specified) via the adapter without starting the server. The legacy `scripts/runner-stub.js` CLI still exists for direct local stub debugging only.
- `npm run hub` — launches the zero-dependency UI server at [http://localhost:3000](http://localhost:3000). Use **Validate** then **Run** to create a `.ai-runs/<run_id>/artifact.txt` file and view the status/diff/checks/artifacts/logs on screen (Vault Index button reads whatever `npm run vault:index` last generated).
- `npm run vault:index` — (re)generate `vault/index.json` from the contents in `.ai-runs/`. Run this whenever new evidence should be surfaced through `/api/vault/index`.
- **GitHub MCP sample** (`scripts/sample-job.github.mcp.json`): `export GITHUB_TOKEN=<read-only token>` (optional), then run `node scripts/run-job.js --job scripts/sample-job.github.mcp.json --role operator` or use the Hub UI. Successful runs materialize `.ai-runs/<run_id>/github_repo_meta.json` with repo metadata fetched via the GitHub API.
- **Figma MCP sample** (`scripts/sample-job.figma.mcp.json`): `export FIGMA_TOKEN=<read-only figma personal access token>`, set `figma_file_key` (or URL) in the job JSON, then execute `node scripts/run-job.js --job scripts/sample-job.figma.mcp.json --role operator`. Completion produces `.ai-runs/<run_id>/figma_file_meta.json` containing the Figma file metadata.
- **Claude MCP offline smoke（絶対に最初に実行）**: `node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator` を必ず先に走らせる（ネットワーク／Claude CLI 不要）。  
絶対ルール：実際の指示（本番ジョブ）を流す前に、必ず offline smoke（local_stub）を先に通して接続/配線を確認する。
  - **成功**: `.ai-runs/<run_id>/run.json` / `audit.jsonl` / `claude_mcp_smoketest.json` が揃う。  
  - **失敗**: `run.json` / `audit.jsonl` は必ず残り、`run.json.checks` / `logs` で `mcp_exec` を見て切り分ける（`claude_mcp_smoketest.json` は欠けても可）。  
- **Claude Code MCP smoke test（環境が許せば任意で実行）** (`scripts/sample-job.claude.smoke.json`): `node scripts/run-job.js --job scripts/sample-job.claude.smoke.json --role operator`。  
  - Claude CLI が未導入／`claude` コマンドが見つからない／外向き通信が封鎖されている場合は失敗するため、その際は必ず offline smoke に戻って原因を切り分ける。  
  - **Success**: `.ai-runs/<run_id>/claude_mcp_smoketest.json` is written alongside the usual `run.json` / `audit.jsonl` evidence.  
  - **Failure** (missing CLI, MCP handshake errors, timeout, etc.): `run.json` / `audit.jsonl` still land under `.ai-runs/<run_id>/` and contain an `mcp_exec` check plus the stderr reason, but `claude_mcp_smoketest.json` may be absent. Review `run.json.checks` and `run.json.logs` to triage the root cause.
- **失敗時トリアージの見どころ**  
  1. `.ai-runs/<run_id>/run.json.runnerResult.status` で OK/Error を確認  
  2. `.runnerResult.checks` の `id: "mcp_exec"` と `.runnerResult.logs` を読む（stderr 相当）  
  3. `.ai-runs/<run_id>/audit.jsonl` の `RUN_END.checks_summary` で通過数/失敗IDを把握

---

## Hub Jobs 最短ループ（手動確認フロー）
1. `/jobs` にアクセスし、Offline Smoke Job を生成する（プロバナンス入力後に JSON をコピー）。
2. 生成した JSON を `job.offline_smoke.json` などのファイルへ保存する。
3. ルートで `node scripts/run-job.js --job job.offline_smoke.json --role operator` を実行する。
4. 実行後に `.ai-runs/<run_id>/run.json` と `audit.jsonl` を開き、中身をコピーする。
5. `/jobs` の Run Result Intake に貼り付けて Parse し、Gate/Triage が想定どおり表示されることを確認する。
- Hub UI の表示言語は既定で日本語です。画面右上の Language セレクタで English に切り替えられ、選択内容は `?lang=ja|en` と `localStorage (hub.lang)` に保存されます。
Offline smoke → Docs Update → Repo Patch（allowed_paths で限定）の順で段階導入し、まず offline smoke で接続確認、その後 docs_update で安全な1ファイル差分、最後に repo_patch で限定的なコード改変というステップを徹底する。
