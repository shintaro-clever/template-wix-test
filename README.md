# figma-ai-github-workflow

Figma × AI × GitHub を「壊れない運用」で連携させるための標準リポジトリ（テンプレ）です。  
このリポジトリはプロダクト本体ではなく、**開発プロセス（正規ルート）／テンプレ／CIゲート**を提供します。

---

# Figma × GitHub × AI Bootstrap

## Goal
- Issue → PR → Decision を 1分以内にトレース可能にする
- “会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）
- テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

---

## Canonical Workflow（正規ルート）
1. **Issue作成（AI Bootstrapフォーム）**
   - Figma URL（案件で固定）
   - Default AI（案件で固定）
   - AI thread URL(s)（複数可）
   - Acceptance Criteria（最低3つ）
2. **ブランチ作成**
   - `issue-<number>-<slug>`（例: `issue-12-report-config`）
3. **実装 → コミット**
4. **PR作成（PRテンプレ使用）**
   - `Fixes #<issue>` を必ず入れる
   - ACは最低1つ `- [x]` にする（Gate通過条件）
   - AIを切り替えた場合のみ Notes に記載（任意）
5. **PR Gate が緑 → Merge**
6. **Decision（必要なら）**
   - 仕様変更・例外運用が発生したら Issue に追記（SoTを崩さない）

---

## Rules（必須）
### Issue（案件のSoT）
- Figma URL / Default AI / AI thread URL(s) / AC を必須入力
- Figmaは案件内でURLを切り替えない（同一URL運用）

### PR（実装単位）
- `Fixes #<issue>` 必須
- `- [x] ...` のACが最低1つ必須（PR Gateで検証）
- Figma URL / AI thread URL(s) は PRでは必須にしない（Issueを正とする）
- AIを切り替えた場合のみ Notes に追記（任意）

---

## 🧾 Decision（意思決定ログ）
意思決定は **PR本文ではなく Issueコメント** に残します（Issueが正本）。

フォーマット（コピペ）:
- **Decision**: <結論>
- **Reason**: <理由 / 背景>
- **Alternatives**: <他の案>
- **Impact**: <影響範囲>
- **Links**: <Figma / PR / AI thread URL(s)>

---

## Included
- Issue Form Template: `.github/ISSUE_TEMPLATE/ai-bootstrap.yml`
- PR Template: `.github/PULL_REQUEST_TEMPLATE.md`
- PR Gate (Actions): `.github/workflows/pr-gate.yml`

---

## ⚠️ Enforcement（強制の扱い）
- **PR Gate は必ず判定する**（PR上でチェックが出る）
- ただし、GitHubのプラン/リポジトリ条件によっては **Branch protection の“強制（マージブロック）”が効かない**ことがあります。  
  その場合でも本テンプレは **「運用レール（PR経由）＋CIで検知」**として機能します。
- 運用として **main への直接コミットは禁止（必ずPR経由）** を徹底してください。

---

## 📚 Docs（一次情報）
- 正規ルートと運用ルール: `docs/ai/core/workflow.md`
- Decisionの残し方: `docs/ai/core/decision-policy.md`

---

## 🚀 Current Status（いま出来ていること）
- PR Gate（Actions）：PR本文の必須要素チェック（Issue参照 / Figma / ACチェック）
- Issue Form：Figma URL / AI thread URL(s) / Acceptance Criteria の入力

---

## Next Steps
1. Branch protection（Classic）で **status check を required** に設定する（可能なら）
2. 以降は「Issueフォーム → PRテンプレ → Gate」の正規ルート以外を使わない

