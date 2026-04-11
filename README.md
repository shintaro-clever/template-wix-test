# Wix Studio テンプレート

Wix Studio 案件を素早く立ち上げるためのテンプレートリポジトリです。
Claude Code によるデザインレビュー・品質管理・Velo コード開発のワークフローが組み込まれています。

---

## このテンプレートでできること

| 機能 | 説明 |
|---|---|
| デザインチェック自動化 | `npm run check:design` でフォントサイズ・カラー数を自動検証 |
| AI デザインレビュー | `/design-review` で全チェック項目を評価しレポート出力 |
| Figma 取り込み | `/wix-from-figma <URL>` でモックアップ + Velo コードを生成 |
| PR 品質ゲート | PR ごとにデザインチェックを含む全テストを自動実行 |

---

## 新案件の立ち上げ手順

```
1. 「Use this template」で新リポジトリを作成
2. wix login → wix dev でサイトに接続
3. global.css のブランドカラー・フォントを変更
4. /wix-from-figma <FigmaURL> でモックアップ生成
5. /design-review でチェック → 修正 → PR → wix publish
```

詳細 → `docs/manuals/new-project-setup.md`

---

## ワークフロー概要

```
Figma デザイン
    ↓  /wix-from-figma <URL>  （Claude が実行）
HTMLモックアップ + Velo コード雛形を生成
    ↓  /design-review <ファイル>  （Claude が実行）
デザインチェックレポート（自動 + AI 評価）
    ↓  Claude がコード修正
global.css / Veloコード 更新
    ↓  PR → マージ → wix publish
Wix Studio に反映
    ↓
デザイナーが Wix Editor で仕上げ
```

---

## Claude Code でできること / できないこと

| できること | できないこと（Wix Editor 必須） |
|---|---|
| CSS トークン・ホバー・フォーカスの整備 | 新しいセクション・カラムの追加 |
| フォームバリデーション・CMS 連携 | ブレイクポイントごとの配置調整 |
| 要素の動的表示切替（Velo） | 画像・動画のアップロード |
| デザインチェック自動検証 | アニメーション設定 |

---

## よく使うコマンド

```bash
# デザインチェック（CSS token 自動検証）
npm run check:design

# 全テスト（PR 前に必ず通す）
npm test

# PR 作成
node scripts/pr-up.js

# Wix Studio に公開
wix publish   # → 「Latest commit from origin/main」を選択

# Wix ローカル開発
wix dev --tunnel
```

---

## 案件ごとに変更する値

| 項目 | ファイル |
|---|---|
| ブランドカラー・フォント | `src/styles/global.css` の `:root` |
| サイト ID | `wix.config.json`（`wix dev` で自動設定） |
| ページ Velo コード | `src/pages/<ページ名>.<pageId>.js` |

詳細 → `docs/template-vars.md`

---

## ドキュメント

### セットアップ・運用
- **新案件セットアップ手順**: `docs/manuals/new-project-setup.md`
- デザインレビュー & Wix 反映ワークフロー: `docs/manuals/design-review-workflow.md`
- 立ち上げマニュアル: `docs/manuals/wix-startup-manual.md`
- 立ち上げチェックリスト: `docs/manuals/wix-startup-checklist.md`
- 役割分担表: `docs/manuals/who-does-what.md`
- トラブルシューティング: `docs/manuals/troubleshooting-for-nonengineers.md`
- 用語集: `docs/manuals/wix-glossary.md`

### 品質基準
- デザインチェックシート: `agents/rules/60-design-quality.md`
- デザインチェックシート（原本 CSV）: `docs/quality/design-checklist.csv`

### AI ルール
- Claude Code 運用ルール: `AGENTS.md`
- コマンド定義: `agents/commands/`
- ルール定義: `agents/rules/`
