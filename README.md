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

## 次のステップ（運用開始）
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
- `./bin/dev` — runs `npm test` first, then starts `node server.js` so you can open [http://127.0.0.1:3000/jobs](http://127.0.0.1:3000/jobs) immediately after the selftest passes.
- `./bin/dev test` — executes `npm test` only (selftest for offline smoke/docs_update/repo_patch samples).
- `./bin/dev smoke` — runs `node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator` for you (offline smoke最優先)。
- `./bin/dev repo-patch` — runs `node scripts/run-job.js --job scripts/sample-job.repo_patch.hub-static.json --role operator`（repo_patch noop挙動の確認用）。
- `./bin/dev serve` — starts the fallback serverのみ（selftestをスキップしたい場合）。
- `node scripts/run-job.js --job scripts/sample-job.json --role operator` — executes any job (local stub by default, MCP if specified) via the adapter without starting the server. The legacy `scripts/runner-stub.js` CLI still exists for direct local stub debugging only.
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
- **OpenAI Exec Smoke（spawn + Codex CLI）** (`scripts/sample-job.openai_exec_smoke.json`): `OPENAI_API_KEY` を設定し、`npx --yes codex` が動く環境で `node scripts/run-job.js --job scripts/sample-job.openai_exec_smoke.json --role operator` を実行。  
  - **Success**: `stdout preview` に `OK` が出て `status:"ok"` になれば疎通完了。stderr に `"Shell snapshot validation failed"` が混ざることがありますが Known Warning 扱いなので、exit=0 であれば無視して構いません（原文は `.ai-runs/<run_id>/spawn_stderr.txt` で確認可能）。
- **失敗時トリアージの見どころ**  
  1. `.ai-runs/<run_id>/run.json.runnerResult.status` で OK/Error を確認  
  2. `.runnerResult.checks` の `id: "mcp_exec"` と `.runnerResult.logs` を読む（stderr 相当）  
  3. `.ai-runs/<run_id>/audit.jsonl` の `RUN_END.checks_summary` で通過数/失敗IDを把握
  - 例: `npm test` → `Selftest ok / [selftest] OK: phase2 samples/docs exist`
  - 例: `./bin/dev smoke` → `{"status":"ok","diff_summary":"repo_patch noop: ...","checks":[{"id":"mcp_exec","ok":true,...}]}`（offline smoke 結果が JSON で表示される）

---

## Hub Jobs 最短ループ（手動確認フロー）
0. （任意）Diagnostics: `/jobs` で Diagnostics ジョブを生成・保存し、`node scripts/run-job.js --job job.diagnostics.json --role operator` を実行。CLI/環境変数を整えてから次へ。
1. Offline smoke: Offline smoke ジョブを保存して `node scripts/run-job.js --job job.offline_smoke.json --role operator` を実行し、接続チェックを通す。
2. Spawn smoke: Spawn smoke ジョブを保存→ `node scripts/run-job.js --job job.spawn_smoke.json --role operator` で shell なし実行を確認。
3. OpenAI exec smoke: `OPENAI_API_KEY` を設定し、`node scripts/run-job.js --job job.openai_exec_smoke.json --role operator` を実行（stderr に "Shell snapshot validation failed" が含まれる場合があるため、`.ai-runs/<run_id>/` 配下の成果物で原文を確認してから判断する）。
4. Docs update: Docs update ジョブを保存→ `node scripts/run-job.js --job job.docs_update.json --role operator` で1ファイル差分を確認。
5. Repo patch: Repo patch ジョブ（noop）を保存→ `node scripts/run-job.js --job job.repo_patch.json --role operator` で限定的な編集のみ通ることを確認。
- 最新の run_id は `RID="$(ls -1 .ai-runs | tail -n 1)"` で取得し、`cat .ai-runs/$RID/run.json` などで参照する。
- Hub UI の表示言語は既定で日本語です。画面右上の Language セレクタで English に切り替えられ、選択内容は `?lang=ja|en` と `localStorage (hub.lang)` に保存されます。
Offline smoke → Spawn smoke → OpenAI exec smoke → Docs Update → Repo Patch の順は SoT で固定されているため、この一本道を崩さずに段階導入してください。

## Runbook: Code→Figma bootstrap（通し手順）

### 前提
- `npm test` が通ること
- `.env` が存在し、必要に応じて `FIGMA_TOKEN` を設定していること
- Codex出力言語は既定で `CODEX_OUTPUT_LANG=ja`

### 1) 正常系（FIGMA_TOKEN なし：plan/nodes まで）
実行:
```bash
npm test
node scripts/run-job.js --job scripts/sample-job.figma_bootstrap.json --role operator
```

期待:

- `status:"ok"`
- artifacts に `.ai-runs/<run_id>/figma_bootstrap_plan.json` と `.ai-runs/<run_id>/figma_bootstrap_nodes.json`
- logs に `figma_api=skipped`（token無しの場合）
- `comment_id=skipped-no-token` 等のスキップ理由が明確

### 2) 正常系（FIGMA_TOKEN あり：Figma API 経由の確認）
実行:
```bash
FIGMA_TOKEN=*** node scripts/run-job.js --job scripts/sample-job.figma_bootstrap.json --role operator
```

期待:

- `status:"ok"`
- logs に `figma_api=enabled`
- `comment_id=<number>` が記録される（環境によりコメント作成の有無は変わるが、失敗理由は where 付きで残る）

### 3) 異常系（Plan保証：target_path/constraints 失敗でも plan が残る）
実行:
```bash
cp scripts/sample-job.figma_bootstrap.json scripts/sample-job.figma_bootstrap.bad_target.json
# bad_target.json の inputs.target_path を vault/targets/NOPE に変更
node scripts/run-job.js --job scripts/sample-job.figma_bootstrap.bad_target.json --role operator || true
```

期待:

- `status:"error"`
- `.ai-runs/<run_id>/figma_bootstrap_plan.json` が必ず存在
- `errors[].where` に `constraints` 等が入り、`root/patterns` を含む

### 4) 後始末（.ai-runs のクリーンアップ）
実行:
```bash
node scripts/cleanup-runs.js --keep 20   # dry-run
node scripts/cleanup-runs.js --keep 20 --apply
```

### トラブルシュート（最小）
- `figma_api=skipped`: `FIGMA_TOKEN` 未設定（正常。tokenを入れると enabled）
- `CODEX_OUTPUT_LANG=en is blocked in CI`: CIでは en が禁止（`ALLOW_CODEX_EN=1` のみ例外）

### AC
- 上記章がSoTに入り、再開時にこの章だけ読めば通せる
- `FIGMA_TOKEN` の有無で挙動が変わる点が明記されている

## Runbook: Hub UI（/connections → /connectors → /runs）

### 目的
CLIを使わずに、HubのUIだけで「接続情報の設定 → 疎通 → run作成/参照 → bootstrap成果物の確認」まで通します。

### 1) サーバ起動
```bash
npm test
bin/dev
```

期待:

- 起動ログにポートが出る
- `GET /jobs` が 200（必要なら `curl -I /jobs`）

### 2) Connections（接続情報の入力）

ブラウザで `http://localhost:<port>/connections` を開き、以下を入力して保存します。

- GitHub（必要な場合）
- Figma（FIGMA_TOKEN 相当）
- OpenAI/Codex（必要な場合）

期待:

- 保存後にリロードしても入力値が保持される
- 検証用途の保存先は `apps/hub/data/connections.json`（平文。検証限定）

### 3) Connectors（疎通テスト）

`http://localhost:<port>/connectors` を開き、対象コネクタで「疎通テスト」を実行します。

期待:

- 成功/失敗が画面に表示される
- 失敗時も理由が表示される（曖昧な無反応にしない）

### 4) Runs（実行と成果物の確認）

`http://localhost:<port>/runs` を開き、直近runを開きます。

期待:

- run単位で logs / artifacts が参照できる
- `figma_bootstrap_plan.json` / `figma_bootstrap_nodes.json` が確認できる（成功/失敗どちらでも plan が残る）

### トラブルシュート（最小）
- `/connections` の保存が効かない: `apps/hub/data/connections.json` の作成権限/パスを確認
- `figma_api=skipped`: `FIGMA_TOKEN` 未設定（正常。token設定で enabled）
- artifacts が見えない: `.ai-runs/<run_id>/` の生成有無と、run一覧が最新を指しているか確認

### AC
- README上でUI版Runbookが追加され、CLI版と矛盾しない
- UIだけでも「接続→疎通→run→成果物参照」まで到達できる

> NOTE: 一部の開発環境ではポート listen が禁止される場合があります。その場合は `npm test`（Selftest）が `/jobs` / `/connections` / `/connectors` / `/runs` の主要経路を直接ハンドラ実行で検証します。

## 開発環境の言語設定
- `.env.example` に `CODEX_OUTPUT_LANG=ja` を定義済みです。ローカル環境では `.env` を作成して同じ値を設定し、Codexの返答を日本語に固定してください。
- 英語テンプレートが必要なケースのみ `CODEX_OUTPUT_LANG=en` を指定します（未設定時は常に日本語が適用されます）。
- CI で `CODEX_OUTPUT_LANG=en` を使う場合は必ず `ALLOW_CODEX_EN=1` を併用し、許可がない英語出力をSelftestがブロックするようにしてください。
- ポリシーの詳細は `AI_DEV_POLICY.md` を参照し、`npm test`（Selftest）が英語テンプレ混入を検知して失敗する仕組みになっています。

## Connections 設定UI（暫定）
- `node server.js` でサーバを起動すると `http://localhost:3000/connections` から AI / GitHub / Figma の接続情報を入力・保存できます（保存先: `apps/hub/data/connections.json`）。再読込すると最新の値がフォームに復元されます。
- 本番環境では必ず Secrets 管理（Vault や CI Secrets）へ移行してください。ここでの保存はローカル検証用途のみです。

## CHANGELOG (2026-02-21)

### Phase2: Code→Figma bootstrap の安定化
- repo_local_path を path.resolve 優先で解決し、存在しない場合は root/pattern を含めて失敗理由を確定できるようにした。
- PlanWriter を導入し、run開始直後に `.ai-runs/<run_id>/figma_bootstrap_plan.json` を初期化。成功/失敗に関わらず finally で再書き込みし、errors.where/root/patterns を必ず残す（Plan保証）。
- Figma API 呼び出しを `src/figma/api.js` に集約し、depth を常に整数>=1（未指定は除外）に正規化。FIGMA_DEBUG/FIGMA_API_MOCK で発射ログ/モック検証を追加し、CIで担保。

### 運用: `.ai-runs` の肥大化対策
- `scripts/cleanup-runs.js` を追加。デフォルト dry-run、`--apply` で削除。`--keep` と `--days` の双方を selftest で担保。

### 開発環境: Codex出力の日本語既定（恒久化）
- `CODEX_OUTPUT_LANG=ja` を既定化し、`src/codex/prompt.js` を唯一の入口として `src/codex/policies/ja.md|en.md` を付与。
- CIでは `CODEX_OUTPUT_LANG=en` を原則禁止し、`ALLOW_CODEX_EN=1` のみ例外許可（selftestで担保）。

> 正のSoT（運用ルール・開発環境ポリシー）は `AI_DEV_POLICY.md` を参照してください。  
> 環境構築の正（非エンジニア向け手順）は別途「環境構築 手順書（SoT）」を参照します。
