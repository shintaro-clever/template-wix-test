# Integration Hub Codex Runbook (SoT)

## Objective
Codex should be able to:
- implement minimal verified changes,
- generate PR body that strictly matches `.github/PULL_REQUEST_TEMPLATE.md`,
- push branch,
- create or update PR when GitHub API is reachable,
- otherwise output PR body for manual paste in GitHub Web UI.

## Non-negotiable rules
1) **No guessing**: PR body must be based on `git show --stat` and `git diff --name-only` for the current branch. Do not describe changes not present in the diff; the generators (`scripts/gen-pr-body.js` / `scripts/pr-body-verify.js`) must rely on these commands as the single source of truth.
2) **Template lock**: PR body must follow `.github/PULL_REQUEST_TEMPLATE.md` section order and wording.
3) **Checkbox rules**:
   - In "関連Issue": exactly one of the two must be `[x]`.
   - In "完了条件": at least one must be `[x]`.
4) **Verification**: run `npm test` before push.
5) **Conflict handling**: prefer `git merge origin/main` (no rebase). Keep diff minimal and avoid unrelated edits.
6) **Network policy**:
   - Before any `gh pr create/edit`, run `curl -I https://api.github.com`.
   - If unreachable, do NOT run `gh pr` commands. Instead print PR body for manual paste.
   - If `getent hosts github.com` fails in the current environment, skip all `git push` / `gh pr` attempts and only output `/tmp/pr.md` plus the steps to run in a network-reachable environment.

## Default workflow (Codex executes)
0) Observe repo state:
   - `git status`
   - current branch name
1) Sync:
   - `git fetch origin`
2) Make minimal change required by the task.
3) Run:
   - `npm test`
4) Commit:
   - concise message (e.g. `chore: ...` / `fix: ...` / `feat: ...`)
5) Push:
   - `git push -u origin <branch>`
6) PR body:
   - `node scripts/gen-pr-body.js` (uses git diff to fill template without guesswork)
   - `node scripts/pr-body-verify.js /tmp/pr.md` (guards template compliance)
7) PR operation:
   - if API reachable: `gh pr create` (or `gh pr edit` if PR exists) using `--body-file /tmp/pr.md`
   - else: `cat /tmp/pr.md` and instruct user to paste in Web UI.

## What user needs to type (minimal)
- 「PRあげてください」

## PR Up（「PRあげてください」運用）

### ユーザー入力（最小）
- ユーザーは「PRあげてください」とだけ指示する

### Codex の実行（固定）
- Codex は必ず `node scripts/pr-up.js` を実行する
- 失敗時は「失敗したコマンド」と「ログ抜粋（末尾数行）」を返す

### ネットワーク判定（既存ルールと整合）
- `getent hosts github.com` が失敗する環境では `git push` / `gh pr` を試行しない
- その場合は `/tmp/pr.md` を生成・検証し、`cat /tmp/pr.md` と「ネットワーク可環境で実行すべきコマンド」を提示して終了する

### 2レーン運用（停止しない）
- レーンA（ネットワーク可）：`node scripts/pr-up.js` で push→PR作成/更新まで完走
- レーンB（ネットワーク不可）：フォールバック案内に従い、ネットワーク可環境で push を実施後に再度 `node scripts/pr-up.js`
- CLI 実行が難しい場合は `/tmp/pr.md` を GitHub Web UI に貼り付けて PR本文とする

### 初回の最終確認（必須）
運用開始前にネットワーク可環境で一度だけ、`node scripts/pr-up.js` が push→PR作成→PR Gate 緑まで完走することを確認する。
