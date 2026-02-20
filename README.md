# figma-ai-github-workflow

Integration Hub で **プロジェクト（リポジトリ）を量産**するときに使う  
**標準テンプレート（運用レール / ガードレール / SoT）**です。

このリポジトリは、各プロジェクトで **Figma × AI × GitHub** を「壊れない運用」で回すための  
**共通ルール・CIゲート・一次情報（SoT）**を提供します。

---

## Goal（このテンプレの目的）

- Issue → PR → Decision を短時間でトレース可能にする
- “会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）
- テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

---

## This Repo Provides（配布物）

- Issue Form Template（AI Bootstrap）
- PR Template
- PR Gate（GitHub Actions）
- Docs（SoT：workflow / decision policy / Phase2-min specs など）

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
- `Figma URL / Default AI / AI thread URL(s) / Acceptance Criteria` を必須入力

### PR（実装単位）
- `Fixes #<issue>` 必須
- AC（チェック済み）が最低1つ必須（PR Gateで検証）

---

## Product UI（本体UIの構成）

本体プロダクトは以下の導線を想定します。

1. **Connectors（一覧）**：対応ツール（コネクタ）を一覧表示し、検索/フィルタで選択する
2. **Connector詳細（設定）**：ツールごとの接続情報（Token/OAuth/権限）を設定し、状態（未設定/接続OK/権限不足/エラー等）を表示する
3. **Account（アカウント設定）**：ワークスペース・権限・保存方針（Secrets移行など）を管理する
4. **Chat（操作入口）**：チャット画面から、Figma / GitHub / AI を横断して作業を進める

---

## Not Included（このテンプレが提供しないもの）

- Integration Hub 本体（RBAC/Audit/UI/APIなどのサービス実装）
- 各プロジェクト固有のプロダクト実装コード

---

## Docs（一次情報）

- 正規ルートと運用ルール: `docs/ai/core/workflow.md`
- Decisionの残し方: `docs/ai/core/decision-policy.md`

---

## Current Status（いま出来ていること）

- PR Gate（Actions）：PR本文の必須要素チェック（Issue参照 / Figma / ACチェック）
- Issue Form：Figma URL / AI thread URL(s) / Acceptance Criteria の入力
- Phase1 Integration Hub Stub（検証器としての `/jobs`）
- Connections 設定UI（暫定）

---

## Quickstart（ローカル起動）

```bash
npm test
./bin/dev
# open:
# http://127.0.0.1:3000/jobs

## Phase1 Integration Hub Stub（検証器：/jobs）

`/jobs` は本体UIではなく、Phase2 の「ジョブ生成→実行→結果取り込み→次アクション」を回すための **検証用UI**です。

### Hub Jobs 最短ループ（手動確認フロー）

0. （任意）Diagnostics: `/jobs` で Diagnostics ジョブを生成・保存し、実行  
1. Offline smoke  
2. Spawn smoke  
3. OpenAI exec smoke  
4. Docs update  
5. Repo patch（noop）

```bash
# 1) Offline smoke
node scripts/run-job.js --job job.offline_smoke.json --role operator

# 2) Spawn smoke
node scripts/run-job.js --job job.spawn_smoke.json --role operator

# 3) OpenAI exec smoke
# OPENAI_API_KEY を設定してから実行
node scripts/run-job.js --job job.openai_exec_smoke.json --role operator

# 4) Docs update
node scripts/run-job.js --job job.docs_update.json --role operator

# 5) Repo patch（noop）
node scripts/run-job.js --job job.repo_patch.json --role operator

最新 run_id:

RID="$(ls -1 .ai-runs | tail -n 1)"

stderr に既知の警告が含まれる場合があるため、.ai-runs/<run_id>/ 配下の成果物で原文を確認してから判断してください。


---

## これでスクショの問題は解消します
- コマンドが横長の灰色ラベル（インライン）にならず、縦に整列したコードブロックになる
- 視認性が一気に戻る

---

## 追加で1点（任意だけど推奨）
同じ理由で `Connections 設定UI（暫定）` の `node server.js` とURLも、インラインではなく短いコードブロックにすると見やすいです。

---

この置換をGitHubのREADME editで入れた後、同じ箇所のスクショをもう一回貼ってください。表示が整ったことを確認したら、次は **/connectors（一覧）** のREADME導線（1〜2行）だけ追加します。
