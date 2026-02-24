# Canonical Workflow (Figma × AI × GitHub)

## Purpose
This document defines the single, canonical workflow for this org.
The goal is: PR → Issue → Figma → Decision must always be traceable.

## Canonical Flow
1. Create a GitHub Issue
   - Must include: Figma URL, AI thread URL, Acceptance Criteria
2. AI planning / design
   - Use the Issue as the input source of truth
   - Final decisions must be written back to the Issue (Decision section)
3. Update Figma
   - Frame naming: `[#<issue>] <screen>/<state>`
   - Frame description must include the Issue URL
4. Implement in GitHub via PR
   - PR body must include:
     - `Fixes #<issue_number>`
     - Figma URL
     - Acceptance Criteria checklist (checkboxes)
5. Review & Merge
   - Review comments remain in PR
   - Merge only when Acceptance Criteria are satisfied

## Non-negotiables
- No work starts without an Issue
- No merge without PR Gate passing
- No “decisions only in chat”
  - Every decision must be reflected in the Issue

## Artifacts (where things live)
- Requirements / Acceptance Criteria: GitHub Issue
- Decisions: GitHub Issue (Decision section)
- Design source: Figma (linked to Issue)
- Implementation source: GitHub PR / code
- Review history: GitHub PR
- Phase2 enforcement design (RBAC / Vault / Audit): `docs/ai/core/phase2-integration-hub.md`

## PR Up（「PRあげてください」運用）

### 目的
ユーザー入力を「PRあげてください」に統一し、Codexが `node scripts/pr-up.js` を実行するだけで  
PR作成までの運用レール（自動完走 or フォールバック案内）に到達できる状態に固定する。

### pr-up.js が実行するステップ（標準フロー）
`node scripts/pr-up.js` は以下を順番に実行する。

1. ブランチガード：`main/master` 直上での実行を拒否（事故防止）
2. `npm test`
3. PR本文生成：`node scripts/gen-pr-body.js` → `/tmp/pr.md`
4. PR本文検証：`node scripts/pr-body-verify.js /tmp/pr.md`
5. `git push -u origin <branch>`
6. `curl -I https://api.github.com` によるAPI到達性判定
7. （到達可）`gh pr create/edit --body-file /tmp/pr.md` により PR 作成/更新  
   （到達不可）`cat /tmp/pr.md` を出力し、Web UI貼り付けで完了

### git push 失敗時のフォールバック（必ず案内して終了）
この環境は DNS 解決できない場合があるため、`git push` が失敗した場合は以後の処理に進まず、
以下を必ず案内して終了する。

- `/tmp/pr.md` は生成済み（`cat /tmp/pr.md` で取得可能）
- 次に実行すべきコマンド（例）：
  - `git push -u origin <branch>`（ネットワーク可環境で再実行）
  - 可能なら `node scripts/pr-up.js` をネットワーク可環境で再実行

### 2レーン運用（環境制約に合わせて停止しない）
- レーンA（ネットワーク可環境）
  - `node scripts/pr-up.js` だけで push → PR作成/更新まで完走
- レーンB（ネットワーク不可環境）
  - `node scripts/pr-up.js` は push 失敗時にフォールバックを表示
  - 指示に従い、ネットワーク可環境で `git push -u origin <branch>` を実行し、その後 `node scripts/pr-up.js`
    （または `gh pr create/edit --body-file /tmp/pr.md`）でPRまで完了
- 代替（Web UI）
  - CLI 実行が難しい場合は `cat /tmp/pr.md` の内容を GitHub Web UI に貼り付けて PR本文とする

### 初回の最終確認（ネットワーク可環境で一度だけ）
運用開始前に、ネットワーク可環境で以下を一度だけ満たすことを確認する。

- `node scripts/pr-up.js` が push → PR作成/更新まで完走する
- PR本文が `.github/PULL_REQUEST_TEMPLATE.md` 準拠で、関連Issueチェックが1つ、ACが最低1つチェック済み
- PR Gate が緑になる

以後は「PRあげてください」の一言で、上記運用レールに従って処理できる。
