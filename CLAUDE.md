# CLAUDE.md

このリポジトリで Claude Code を使う場合、運用ルールの SoT は `AGENTS.md` と `agents/*` に置く。
このファイルは Claude 向けの入口のみを定義し、詳細手順は SoT 参照に統一する。

## Priority

1. `AGENTS.md`
2. `agents/contracts/response-language.md`
3. `agents/rules/*`
4. `agents/commands/*`
5. `agents/skills/*`

## Absolute Rules

グローバル設定（`~/.claude/CLAUDE.md`）に準拠。

## Branch / PR Workflow

- ブランチ名は `issue-<number>-<slug>`。
- 「PR あげてください」系の完了処理は必ず `node scripts/pr-up.js` を実行する。
- `pr-up.js` 失敗時は `AGENTS.md` の Failure Reporting Rules に従う。

## Language

- 返答本文は日本語を使う（英語明示指示がある場合のみ英語可）。
- コード/ログ/機械可読出力は原文のままでよい。
