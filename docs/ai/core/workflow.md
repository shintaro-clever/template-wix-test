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

## ARCH-00 Phase Boundary (SoT)

### Current Phase (In Scope)
- Personal AI Settings: 既定AIを **1件のみ** 使用する。
- Project Settings: GitHub / Figma / Drive をプロジェクト単位で共有する。
- Thread Run Composition: Thread 実行時は以下を合成して Run を起動する。
  - 個人AI設定（既定AI 1件）
  - プロジェクト共有環境（GitHub/Figma/Drive）
  - 会話履歴（Thread messages）

### Next Phase (Out of Scope for now)
- 複数AI接続（同時選択・切替・優先順制御）
- 役割設定（role/profile/persona の分岐運用）

### Next Phase SoT (Design Only / No Implementation in Current Phase)
- Personal AI Settings は「既定1件」から「複数接続」へ拡張する。
  - 例: provider/model/secret_ref を複数件保持し、接続ごとに enabled 状態を持つ。
- 役割設定（role/profile/persona）を導入し、役割ごとに優先AI接続を割り当てる。
  - 例: `planner`, `implementer`, `reviewer` などの role ごとに ai_setting_id を紐付ける。
- Workspace/Run では、実行時に「どの role がどの ai_setting を選んだか」を追跡可能にする。
  - 追跡対象例: `role`, `selected_ai_setting_id`, `fallback_chain`, `selection_reason`。
- ただし現フェーズでは実装しない（設計境界のみ保持）。
  - 現フェーズの実装は引き続き「既定AI 1件」を正とする。

この境界を越える仕様追加は、次フェーズ文書へ分離して管理する。

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
