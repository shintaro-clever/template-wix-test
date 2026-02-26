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
