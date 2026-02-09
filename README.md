# figma-ai-github-workflow
Figma × AI × GitHub を「壊れない運用」で連携させるための標準リポジトリ（テンプレ）です。  
このリポジトリ自体はプロダクト本体ではなく、**開発プロセス・テンプレ・ゲート（強制ルール）**を提供します。

## 🎯 Goal
- PR → Issue → Figma → Decision を **常に1分以内にトレース可能**にする
- “会話で決めた”が消えないよう、**意思決定をGitHubに残す**
- テンプレとCIで **リンク欠損・ルール逸脱を物理的に防止**する

## ✅ Canonical Workflow（正規ルート）
1. GitHub Issue（要件 / 受入条件 / Figmaリンク / AIスレリンク）
2. AIで設計・検討 → 結論をIssueの「Decision」に反映
3. Figma更新（Frame名/DescriptionにIssue番号とリンクを埋める）
4. GitHub PR（Fixes #Issue、Figmaリンク、受入条件チェック）
5. PR Review → Merge

> 例外的なショートカットは禁止（破綻の原因）。

## 📌 Rules（必須）
- Issueには **Figma URL / AIスレURL / Acceptance Criteria** を必須入力
- PRには **Issue参照（Fixes #123）/ Figma URL / 受入条件チェック** を必須入力
- ルール違反のPRは **CIでFail**（マージ不可）

## 📚 Docs（一次情報）
- 正規ルートと運用ルール: `docs/ai/core/workflow.md`
- Decisionの残し方: `docs/ai/core/decision-policy.md`

## 🧩 Included
- GitHub Issue Template（必須項目の強制）
- GitHub PR Template（レビュー観点の統一）
- PR Gate（Actions）：Issue参照 / Figmaリンク / チェックリストの検証

## 🚀 Next Steps
1) READMEを確定（このページ）  
2) `docs/ai/core/` を作成して一次情報を置く  
3) Issue/PRテンプレ、PRゲート（Actions）を追加  
4) この標準器を本体リポジトリへ移植
