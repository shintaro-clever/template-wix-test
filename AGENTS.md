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

---

## VPS Reflection Check / VPS反映チェック

VPS反映時は `agents/rules/10-network.md` の手順を必ず実施すること。  
特に以下を必須とする:

- 反映前に `bin/vps 'echo connected'` を先に実行
- 接続失敗時は SSH 連打禁止（`fail2ban` BAN を疑って停止）
- Workspace系修正時は反映後に `Project詳細 -> Workspace -> 左カラム会話一覧 -> 新規会話開始 -> chat最小送信 -> 設定導線` を確認

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
