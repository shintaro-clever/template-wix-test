---
name: pr-workflow
description: PR作成運用。PR時は `unset GITHUB_TOKEN && node scripts/pr-up.js` を実行し、PR後にローカルを最新化する。
---

# PR Workflow

## Purpose
PR作成運用を固定する。

## Inputs
- 作業ブランチ名
- PR作成の依頼
- PRマージ完了の報告

## Outputs
- PR作成済み
- PR後のローカル最新化完了

## Steps
1. 作業ブランチ上であることを確認する（`main`/`master`禁止）。
2. 必ずこの順で実行する：
   ```bash
   unset GITHUB_TOKEN
   node scripts/pr-up.js
   ```
3. 出力された手順に従ってPR作成まで完了させる。
4. PRマージ完了後、ローカルを最新化する。
5. ローカル最新化の手順:
   `git checkout main`
   `git pull --ff-only origin main`
   `git branch -d <working-branch>`

## Constraints
- `unset GITHUB_TOKEN && node scripts/pr-up.js` を唯一入口とする。
- escalated は通常の `git push` が sandbox 制限で失敗した場合のみ検討する。通常経路で成功する場合は使わない。
- `/tmp/pr.md` を手動編集しない。
- `gh pr create` / `gh api -X POST .../pulls` / 手動push+PR作成は理由を問わず禁止。

## DoD
- PR作成完了
- PR後のローカル最新化完了

## Failure
- 失敗時は失敗コマンドとstderr末尾をそのまま報告する。

## Conflict Reporting
- 競合を解消した場合、報告に以下を必ず含める。
- 何の競合だったか
- どの変更同士を両立したか
- どのファイルで何を残したか
- テスト再実行の有無
- PR URL と merge commit
