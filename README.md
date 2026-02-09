# figma-ai-github-workflow

Figma × AI × GitHub を「壊れない運用」で連携させるための標準リポジトリ（テンプレ）です。  
このリポジトリはプロダクト本体ではなく、**開発プロセス（正規ルート）／テンプレ／CIゲート**を提供します。

---

## 🎯 Goal（このテンプレが解決すること）
- **Issue / PR / Figma / AIログ / Decision** を 1分以内に相互トレースできる状態を作る
- 「会話で決めた」が消えないよう、**意思決定ログをGitHub（Issue）に残す**
- テンプレとCIで **リンク欠損・受入条件漏れ** を検知し、手戻りを減らす

---

## ✅ Canonical Workflow（正規ルート）
1. **GitHub Issue を作成**（Figma URL / AI thread URL(s) / Acceptance Criteria を入力）
2. **AIで設計・検討**（ChatGPT / Gemini / Claude 等、複数可）
3. **DecisionをIssueコメントに残す**（結論・理由・代替案・影響範囲・リンク）
4. **Figma更新**（Frame名 or Description に Issue番号と参照を埋める）
5. **GitHub PR 作成**（Fixes/Closes #Issue、Figma URL、ACチェック済み）
6. **PR Gate が PASS（緑） → Merge**

> 例外的なショートカット（Issueなし／Figmaなし／ACなし／Decisionなし）は破綻の原因なので禁止。

---

## 📌 Rules（必須）
### Issue（必須）
- **Figma URL**（`figma.com/design/` または `figma.com/file/`）
- **AI thread URL(s)**（複数可：ChatGPT / Gemini / Claude 等。最低1つ）
- **Acceptance Criteria**（後でPRでチェックできる形で明文化）

### PR（必須：PR Gateで検証）
- **Issue参照**：`Fixes #123` または `Closes #123`
- **Figma URL**：`https://www.figma.com/design/...` または `https://www.figma.com/file/...`
- **ACチェック済みが最低1つ**：`- [x] ...`

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

## 🧩 Included（このリポジトリに入っているもの）
- **Issue Form Template**：Figma / AI thread URL(s) / Acceptance Criteria を入力させる
- **PR Template**：Issue参照・Figma・ACチェックを標準化
- **PR Gate（GitHub Actions）**：PR本文の必須要素を検証して Fail/Pass を出す

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

## 🚀 Next Steps（残タスク）
1) `docs/ai/core/` を作成して一次情報を置く（workflow / decision-policy）  
2) PRテンプレを最終確定（運用に必要十分な項目だけ）  
3) この標準器を本体リポジトリへ移植（同一構成でコピー）

---
