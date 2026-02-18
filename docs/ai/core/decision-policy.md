# Decision Policy

## Why
Decisions made only in chat are not durable and not reviewable.
This policy forces decisions to be stored where the work is tracked: GitHub Issues.

## Rule
All decisions must be written to the linked Issue in the `Decision` section (or as a clearly labeled comment).

## Format (required)
Write decisions in the following minimal format:

Decision:
- <what we decided>

Reason:
- <why we decided it>

Impact:
- <what changes because of this decision>
- <what is explicitly NOT changing>

Links:
- Figma: <url>
- PR (if any): <url>

## Examples
Decision:
- Use backend-calculated rollups instead of frontend-only computation

Reason:
- Data sources will increase; backend becomes the stable contract

Impact:
- API response includes rollup fields
- Frontend renders values only (no derived rollups)
- Existing UI remains unchanged

Links:
- Figma: ...
- PR: ...

Phase1（solo）完了条件達成

Codex CLI 導入（npm global）とプロジェクト設定（.codex/）を整備

PR Gate（actions/github-script）運用が成立：PR本文の「関連Issue/No Issue」二択 + AC最低1つチェックを必須化

Gate通過証跡を docs/ai/core/MANUAL_pr-gate.md に集約（Actions Run URL を記録）

以後、軽微変更は No Issue（理由） 運用を許容し、参照リンクは原則 Issue / docs に集約