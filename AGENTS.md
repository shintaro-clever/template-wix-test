# AGENTS.md

このファイルは「入口（Index）」です。詳細ルール/手順は `agents/rules/*` と `agents/commands/*` に分割して移設します。  
このファイルには **最小限の絶対ルール**のみを残します。

---

## ⛔ PROHIBITED ACTIONS — Read Before Anything Else

These rules are absolute. No exceptions, no overrides.

- **MUST NOT** run on `main` or `master`. Always work on a feature branch.
- **MUST NOT** use `--dangerously-bypass-approvals-and-sandbox`.
- **MUST NOT** use `--sandbox=danger-full-access`.
- **MUST NOT** issue destructive commands (e.g., `rm -rf`) as standalone Codex instructions.
- **MUST NOT** pass secrets (API keys, tokens) directly to Codex.
- **MUST NOT** expose `.env` or `auth.json` contents to Codex.
- **MUST NOT** manually edit `/tmp/pr.md` — it will be overwritten by the script.
- **MUST NOT** modify placeholder strings in `.github/PULL_REQUEST_TEMPLATE.md` — this breaks parsing in `gen-pr-body.js`.

## ⛔ 禁止事項 — 必ず最初に読むこと

以下のルールは絶対厳守。例外・上書き不可。

- `main` または `master` ブランチで作業**禁止**。必ず feature ブランチで作業すること。
- `--dangerously-bypass-approvals-and-sandbox` の使用**禁止**。
- `--sandbox=danger-full-access` の使用**禁止**。
- `rm -rf` 等の破壊的コマンドを Codex への単体指示として使用**禁止**。
- シークレット（APIキー・トークン）を Codex に直接渡すこと**禁止**。
- `.env` / `auth.json` の内容を Codex に表示させること**禁止**。
- `/tmp/pr.md` の手動編集**禁止**（スクリプトが上書きする）。
- `.github/PULL_REQUEST_TEMPLATE.md` のプレースホルダー変更**禁止**（`gen-pr-body.js` が壊れる）。

---

## Launching Codex / Codex の起動

必ず `workspace-write` で起動すること：

```bash
alias codex='codex --sandbox=workspace-write'
```

- `workspace-write`: 通常運用 ✅
- `danger-full-access`: 使用禁止 ❌

---

## Phase Boundary SoT / フェーズ境界SoT

現フェーズ/次フェーズの境界は `docs/ai/core/workflow.md` の `ARCH-00 Phase Boundary (SoT)` を正とする。
次フェーズ2は「GitHub/Figma読取 → validation（Figma再現度検証）→ controlled write → run/workspace integration」を固定順序とし、完全自動同期と複数AI役割設定は対象外とする。
次フェーズ3は Workspace の `search -> history -> observability -> operability` のみを対象とし、複数AI接続・役割設定、Figma/GitHub 高度操作の追加拡張、完全自動同期は対象外とする。
次フェーズ4は **Phase3完了後にのみ** 着手し、Fidelity Hardening（Figma・コード・本番環境の一致率強化）専用とする。複数AI役割設計の再拡張、無関係な新機能追加、大規模UX刷新は対象外とする。
次フェーズ5は **Phase4完了後にのみ** 着手し、単一運用者前提の `OpenAI運用補助AI` `多言語説明` `FAQボット` `Workspace IA再編` のみに限定する。今後の UI 正本は `/ui/` 配下とし、旧ページ直配信を設計基準に戻さない。
Workspace IA再編は `1枚目=現状UI` `2枚目=目標UI` を前提にし、目標UIは `左=横断ナビ` `中央=AI作業面` `右=接続済みリソース/roadmap/recent files` の3面構成へ寄せる。
Phase5 の対象外は `社内管理画面` `組織ユーザー管理` `RBAC強化` `複数AI routing` `confirmなし自動実行` `完全自律エージェント` とし、これらは Phase6 以降へ分離して混入させない。
次フェーズ6は `社内管理画面` `組織ユーザー管理` `RBAC` `接続ライフサイクル管理` `AI利用管理` `FAQ知識源管理` `多言語設定管理` `監査ビュー` のみを対象とする管理・組織運用レイヤーとし、Phase5 の単一運用者向け Workspace 責務へ逆流させない。`複数AI routing の高度化` `confirmなし自動実行` `完全自律エージェント` は Phase6 にも混入させない。
次フェーズ7は **Phase6完了後にのみ** 着手し、SoT 上 `作成・変更実行レイヤー` 専用とする。対象は `write-plan` `execution plan` `confirm付き変更実行補助` `Figma / GitHub / AI / Run の変更連携` の4領域のみに限定する。
Hubは成果物SoTではない。Hub は orchestration layer として `thread / run / plan / audit` を保持し、成果物の正本は GitHub / Figma / Drive 側に残す。
Phase7 の主要成果物は `execution plan` `confirm flow` `execution job` `audit` `ops console` `selftest` `runbook` とする。
Phase7 の対象外は `confirmなし自動実行` `完全自律エージェント` `複数AI routing の高度化` `Phase5 Workspaceへの管理責務逆流` `Phase6 Adminへの自律実行混入` とし、これらを Phase7 の UI/API/orchestration/運用判断へ混入させない。

Phase7で実装してよいもの:
- `write-plan` / `execution plan` の生成・保存・表示
- operator confirm を前提にした変更実行補助
- `execution job` `audit` `ops console` `selftest` `runbook`
- GitHub / Figma / Drive の成果物正本へ戻すための orchestration 記録

Phase7でまだ実装してはいけないもの:
- confirmなし自動実行
- 完全自律エージェント
- 複数AI routing の高度化
- Phase5 Workspace へ管理画面責務を戻す変更
- Phase6 Admin へ自律実行責務を混入させる変更

---

## VPS Reflection Check / VPS反映チェック

VPS反映時は `agents/rules/10-network.md` の手順を必ず実施すること。  
特に以下を必須とする:

- 反映前に `bin/vps 'echo connected'` を先に実行
- 接続失敗時は SSH 連打禁止（`fail2ban` BAN を疑って停止）
- Workspace系修正時は反映後に `Project詳細 -> Workspace -> 左カラム会話一覧 -> 新規会話開始 -> chat最小送信 -> 設定導線` を確認
- 外部操作フェーズ（GitHub/Figma read/write）を含む反映時は `docs/runbooks/vps-external-operations-checklist.md` の確認手順を必ず実施

---

## Branch Naming Convention / ブランチ命名規則

Branch names **MUST** follow:

```text
issue-<number>-<slug>
```

例: `issue-42-ms0-schema`

Start each task from latest `main` (when network operations are allowed):

```bash
git checkout main
git pull --ff-only origin main
git checkout -b issue-<number>-<slug>
```

---

## Dispatcher 共通運用ルール

Claude Code / Codex が Issue を自律実行する際の境界ルール。詳細正本は `~/.claude/CLAUDE.md`。

### 基本方針

- 正本は Sheets
- エージェントは受け身ではなく、取得・記録・判定まで能動的に行う
- 人間は `human_review_waiting` のみ確認し、マージ判断を行う
- AIの担当範囲の終点は `human_review_waiting`（マージ・ブランチ削除・post-merge後処理はしない）

### 継続実行・途中確認禁止

- 停止条件に当たるまで継続して進める。状態確認だけで止まらない
- 停止条件以外でユーザーへの途中確認を禁止する（「このまま進めてよいですか」等は運用違反）
- 曖昧さがある場合は、既存ルール・既存実装・最小差分を優先して自律判断する

### 実行ルール

- このIssue達成に必要な最小差分のみ実施する
- 必要なテストを行う
- PRが未作成ならPRを作成する（`unset GITHUB_TOKEN && node scripts/pr-up.js`）
- PR作成後は最新 main との競合有無を確認する
- 競合があれば最小範囲で解消してテストを再実行する
- codexResult / autoReview / Sheets / Issueコメントを更新する
- PR未作成のまま `human_review_waiting` にしない
- `human_review_waiting` に上げるのは、実装・テスト・push・PR・必要記録が揃った場合のみ

### 禁止事項（Dispatcher実行中）

- PRのマージ・ブランチ削除・人間確認前のpost-merge処理
- 他Issueに関する変更・無関係なファイル編集・新仕様の追加
- 既存ルール・デザイン方針の勝手な変更・大きなリファクタ
- 問題を隠したまま `human_review_waiting` に上げること
- 複数Issueの同時起票・勝手なスコープ拡張

### 判断ルール

- 依存未解消なら `blocked`、即着手可能なら `queued`
- PR未作成なら `human_review_waiting` にしない
- 競合解消が安全にできるなら解消して進める。影響範囲が広がる場合は `blocked`
- 複数候補がある場合は、優先度が高く・低リスク・依存の少ないものを選ぶ
- 迷ったら最小差分で止める

### 停止条件

1. `human_review_waiting` 到達
2. `blocked`
3. `auto_review_failed`
4. `StopAt` 到達
5. トークン残量がしきい値以下

### 停止時に必ず残す情報

停止理由 / 現在タスク・ステータス / 完了済みステップ / 未完了ステップ / 次アクション / branch・PR・commit / 競合情報（あれば）

### 次Issueルール

- 明示した場合を除き、自動起票または Queue 追加は **1件まで**
- 次Issueが既に決まっている場合は `queued` にする
- 未設定の場合は親Issue・未完了スコープ・既存キューから最も整合する1件を選ぶ
- 既存Issueで代替できる場合は新規起票より Queue 更新を優先する
- 複数件の起票または連続実行が明示された場合のみ複数件を扱ってよい（同一テーマ・低依存を優先）
- 根拠を記録する

---

## PR Workflow ("PR あげてください")

After completing a task, **MUST** run:

```bash
node scripts/pr-up.js
```

`pr-up.js` is the single entrypoint. Follow its output exactly.

- If Step 1 (`npm test`) fails:
  Stop. Fix tests. Re-run `node scripts/pr-up.js` from the beginning.
- If `git push` or `gh pr *` fails:
  Do not invent procedures. Use the copy-paste recovery commands printed by the script.

Notes:

- Depending on sandbox constraints, the script may instruct an "escalated" execution path.
- Even in that case, `danger-full-access` and bypass options remain forbidden.

---

## Conflict Resolution / コンフリクト解消（必須）

`git status` に `Unmerged paths` が出たら、マーカーを完全解消 → `git add <file>` → `git status` でゼロ確認 → `git commit`。  
その後 `node scripts/pr-up.js` を再実行。

---

## Failure Reporting Rules / 失敗時の報告

Report only:

1. failed command (verbatim)
2. last stderr lines (verbatim)

推測・要約は禁止。

---

## Post-PR Local Cleanup / 後始末（推奨）

PR作成後（またはPR更新後）、作業完了が確定したら：

```bash
git checkout main
git pull --ff-only origin main
git branch -d <working-branch>
```

リモートブランチ削除は PR マージ後（運用ルールに従う）。
