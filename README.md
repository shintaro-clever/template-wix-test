Phase1 Integration Hub Stub（検証器：/jobs）
テスト行（PR動作確認用）

/jobs は本体UIではなく、Phase2 の「ジョブ生成→実行→結果取り込み→次アクション」を回すための検証用UIです。

このリポジトリは、各プロジェクトで **Figma × AI × GitHub** を「壊れない運用」で回すための
**共通ルール・CIゲート・一次情報（SoT）**を提供します。

## Goal（このテンプレの目的）

- Issue → PR → Decision を短時間でトレース可能にする
- “会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）
- テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

## This Repo Provides（配布物）

- Issue Form Template（AI Bootstrap）
- PR Template
- PR Gate（GitHub Actions）
- Docs（SoT: workflow / decision policy / Phase2-min specs など）

---

## Canonical Workflow（正規ルート）

1. Issue作成（AI Bootstrapフォーム）
2. ブランチ作成（例: `issue-<number>-<slug>`）
3. 実装 → コミット
4. PR作成（PRテンプレ使用）
5. PR Gate が緑 → Merge
6. Decision（必要なら Issue コメントに残す）

## Rules（必須）

### Issue（案件のSoT）

- `Figma URL / Default AI / AI thread URL(s) / Acceptance Criteria` を必須入力

## Product UI（本体UIの構成）

本体プロダクトは以下の導線を想定します。

1. **Connectors（一覧）**: 対応ツール（コネクタ）を一覧表示し、検索/フィルタで選択する
2. **Connector詳細（設定）**: ツールごとの接続情報（Token/OAuth/権限）を設定し、状態（未設定/接続OK/権限不足/エラー等）を表示する
3. **Account（アカウント設定）**: ワークスペース・権限・保存方針（Secrets移行など）を管理する
4. **Chat（操作入口）**: チャット画面から、Figma / GitHub / AI を横断して作業を進める

## Not Included（このテンプレが提供しないもの）

- Integration Hub 本体（RBAC/Audit/UI/APIなどのサービス実装）
- 各プロジェクト固有のプロダクト実装コード

---

## 次のステップ（運用開始）

1. このテンプレから新規リポジトリを作成（GitHub Template機能）
2. 必要なら Branch protection で status check を required に設定
3. 以後は Issue → PR → Gate の正規ルート以外を使わない

---

## Docs（一次情報）

- 正規ルートと運用ルール: `docs/ai/core/workflow.md`
- Decisionの残し方: `docs/ai/core/decision-policy.md`
- Connectors/Connections APIスキーマSoT: `docs/connectors-connections-schema.md`

---

## Current Status（いま出来ていること）

- PR Gate（Actions）: PR本文の必須要素チェック（Issue参照 / Figma / ACチェック）
- Issue Form: Figma URL / AI thread URL(s) / Acceptance Criteria の入力
- Phase1 Integration Hub Stub（検証器としての `/jobs`）
- Connections 設定UI（暫定）

## ARCH-00 現フェーズ境界（SoT）

現フェーズの対象:
- 個人設定は既定AIを1件のみ使う
- プロジェクト設定で GitHub / Figma / Drive を共有する
- Thread は「個人AI設定 + プロジェクト共有環境 + 会話履歴」を合成して Run を起動する

次フェーズへ分離する対象:
- 複数AI接続
- 役割設定（role/profile/persona など）

次フェーズSoT（設計のみ、現フェーズ実装対象外）:
- 個人AI設定を複数接続対応へ拡張（enabled/既定/接続ごとの管理）
- role/profile/persona 単位で利用AIを割り当て
- Runで role -> ai_setting 選択結果を追跡可能にする

## API Notes（P2-01 最小）

- `GET /api/connectors`: `id/key/name`, `enabled/connected`, `last_checked_at`, `notes` を返します。
- `GET /api/connections`: `items[]` に同一shape（`id/key/name/enabled/connected/last_checked_at/notes`）を返します。
- Secrets値は返しません。`notes` には presence/LEN のみを含めます。

---

## Quickstart（ローカル起動）

```bash
volta run npm test
./bin/dev
# open:
# http://127.0.0.1:3000/jobs
```

Node は Volta で固定します（`package.json` の `volta.node=22.22.0`）。
`better-sqlite3` の ABI 不一致を避けるため、テストは `volta run npm test` を使用してください。

## Hub Jobs 最短ループ（手動確認フロー）

（任意）Diagnostics: `/jobs` で Diagnostics ジョブを生成・保存し、実行

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

# 最新 run_id
RID="$(ls -1 .ai-runs | tail -n 1)"
```

stderr に既知の警告が含まれる場合があるため、`.ai-runs/<run_id>/` 配下の成果物で原文を確認してから判断してください。

PR test line: one-line README update to verify PR creation flow.
