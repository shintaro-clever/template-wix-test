# PR Workflow Skill

## Purpose
- `/api/runs` のPR作成運用を固定する。

## Usage
- 「/api/runs のPRを作って」などの依頼時に使用する。
- PR作成時は `node scripts/pr-up.js` を escalated で実行する。

## Outputs
- なし（運用手順の指示のみ）。

## Deps
- Node.js
- npm
- git

## Notes
- PR作成後はローカル最新化を必ず行う。
- 競合解消後の報告は詳細に行う。最低限、競合内容、両立した変更、保持したファイル内容、テスト再実行、PR URL、merge commit を含める。
