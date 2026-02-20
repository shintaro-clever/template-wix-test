figma-ai-github-workflow

Integration Hub で プロジェクト（リポジトリ）を量産するときに使う
**標準テンプレート（運用レール / ガードレール / SoT）**です。

このリポジトリは、各プロジェクトで Figma × AI × GitHub を「壊れない運用」で回すための 共通ルールとCIゲートを提供します。

目的（Goal）

Issue → PR → Decision を短時間でトレース可能にする

“会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）

テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

本体UI（プロダクト導線）
1) Connectors（一覧）

**対応しているツール（コネクタ）**を一覧で表示し、検索/フィルタから目的のツールを選びます。

例：GitHub / Figma / Notion / Slack …（対応範囲はコネクタカタログで定義）

状態：未設定 / 設定済み / 接続OK / 権限不足 / エラー 等

2) Connector詳細（設定）

選んだツールごとに、必要な接続情報（トークン/OAuth/権限）を設定します。

例：Notionの場合は Workspace と権限状態（ゲスト等）を表示し、必要なら権限の案内を出す

例：GitHubの場合は owner/repo や token の設定

3) Account（アカウント設定）

ワークスペースや権限、利用者設定、保存方針（Secrets移行など）を管理します。

4) Chat（操作入口）

日常の操作入口としてチャット画面を使い、Figma / GitHub / AI を横断して作業を進めます。

いま入っているもの（テンプレが配布するもの）

Issue Form Template（AI Bootstrap）

PR Template

PR Gate（GitHub Actions）

運用SoT（workflow / decision policy / Phase2-min specs などの docs）

Canonical Workflow（正規ルート）

Issue作成（AI Bootstrapフォーム）

ブランチ作成（例: issue-<number>-<slug>）

実装 → コミット

PR作成（PRテンプレ使用）

PR Gate が緑 → Merge

Decision（必要なら Issue コメントに残す）

Rules（必須）
Issue（案件のSoT）

Figma URL / Default AI / AI thread URL(s) / Acceptance Criteria を必須入力

PR（実装単位）

Fixes #<issue> 必須

AC（チェック済み）が最低1つ必須（PR Gateで検証）

Included

Issue Form Template: .github/ISSUE_TEMPLATE/ai-bootstrap.yml

PR Template: .github/PULL_REQUEST_TEMPLATE.md

PR Gate (Actions): .github/workflows/pr-gate.yml

Docs (SoT): docs/

⚠️ 注意（このテンプレが提供しないもの）

Integration Hub 本体（RBAC/Audit/UI/APIなどのサービス実装）

各プロジェクト固有のプロダクト実装コード

Next Steps（運用開始）

このテンプレから新規リポジトリを作成（GitHub Template機能）

必要なら Branch protection で status check を required に設定

以後は Issue → PR → Gate の正規ルート以外を使わない

📚 Docs（一次情報）

正規ルートと運用ルール: docs/ai/core/workflow.md

Decisionの残し方: docs/ai/core/decision-policy.md

🚀 Current Status（いま出来ていること）

PR Gate（Actions）：PR本文の必須要素チェック（Issue参照 / Figma / ACチェック）

Issue Form：Figma URL / AI thread URL(s) / Acceptance Criteria の入力

Phase1 Integration Hub Stub（/jobs 検証器）

Connections 設定UI（暫定）

Phase1 Integration Hub Stub（検証器：/jobs）

本体UIとは別に、Phase2の「ジョブ生成→実行→結果取り込み→次アクション」を回すための 検証用UI が入っています。

./bin/dev — runs npm test first, then starts node server.js so you can open http://127.0.0.1:3000/jobs immediately after the selftest passes.

./bin/dev test — executes npm test only（selftest）。

./bin/dev smoke — runs node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator（offline smoke最優先）。

./bin/dev repo-patch — runs node scripts/run-job.js --job scripts/sample-job.repo_patch.hub-static.json --role operator（repo_patch noop確認）。

./bin/dev serve — starts the fallback server only（selftestスキップ）。

node scripts/run-job.js --job scripts/sample-job.json --role operator — executes any job（local stub / MCP）。

npm run vault:index — (re)generate vault/index.json from .ai-runs/ evidence.

Hub Jobs 最短ループ（手動確認フロー）

（任意）Diagnostics: /jobs で Diagnostics ジョブを生成・保存し、node scripts/run-job.js --job job.diagnostics.json --role operator を実行。

Offline smoke: node scripts/run-job.js --job job.offline_smoke.json --role operator

Spawn smoke: node scripts/run-job.js --job job.spawn_smoke.json --role operator

OpenAI exec smoke: OPENAI_API_KEY を設定し、node scripts/run-job.js --job job.openai_exec_smoke.json --role operator（stderrに既知の警告が含まれる場合があるため、.ai-runs/<run_id>/ 配下の成果物で原文を確認して判断）

Docs update: node scripts/run-job.js --job job.docs_update.json --role operator

Repo patch（noop）: node scripts/run-job.js --job job.repo_patch.json --role operator

最新 run_id：RID="$(ls -1 .ai-runs | tail -n 1)" → cat .ai-runs/$RID/run.json

言語：右上の Language セレクタ（?lang=ja|en と localStorage (hub.lang)）

Connections 設定UI（暫定）

node server.js を起動すると http://localhost:3000/connections で AI / GitHub / Figma の接続情報を入力・保存できます（保存先: apps/hub/data/connections.json）。

本番環境では必ず Secrets 管理（Vault や CI Secrets）へ移行してください。ここでの保存はローカル検証用途のみです。
