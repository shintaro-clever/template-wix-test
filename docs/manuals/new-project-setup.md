# 新案件セットアップ手順

このテンプレートから新しい Wix Studio 案件を立ち上げる手順を説明します。

---

## 全体の流れ

```
1. テンプレートをコピーして新リポジトリを作成
2. Wix Site と GitHub を接続
3. ブランドカラー・フォントを設定
4. Figma デザインを取り込む
5. デザインレビューを実行して修正
6. Wix Studio に公開
```

---

## Step 1 — リポジトリを作成

GitHub の `template-wix-test` を「Use this template」でコピーして
新しいリポジトリを作成する。

```bash
# ローカルにクローン
git clone https://github.com/<org>/<new-repo>.git
cd <new-repo>
npm install
```

---

## Step 2 — Wix Site に接続

### 2-1. Wix アカウントにログイン

```bash
unset GITHUB_TOKEN
wix login
```

### 2-2. 既存サイトに接続（または新規作成）

```bash
wix dev
```

初回起動時にサイトを選択または新規作成する。
接続が完了すると `wix.config.json` にサイト情報が書き込まれる。

### 2-3. wix.config.json を確認

```json
{
  "siteId": "<自動設定される>",
  ...
}
```

> `wix.config.json` は案件ごとに異なるため `.gitignore` に含めるか、
> リポジトリに含める場合は公開設定に注意する。

---

## Step 3 — ブランドカラー・フォントを設定

`src/styles/global.css` の `:root` 内の値を案件に合わせて変更する：

```css
:root {
    /* ここを案件のブランドカラーに変更する */
    --color-primary:      #2d4c3b;   /* メインカラー */
    --color-primary-dark: #1e3528;   /* ホバー用（primaryより10%暗く） */
    --color-accent:       #1d4ed8;   /* アクセントカラー */

    /* フォントも案件に合わせて変更する */
    --font-base: 'Noto Sans JP', 'Hiragino Sans', 'Meiryo', sans-serif;
    --font-en:   'Inter', 'Segoe UI', sans-serif;
}
```

変更後、デザインチェックを実行して基準内に収まっているか確認する：

```bash
npm run check:design
```

---

## Step 4 — Figma デザインを取り込む

FigmaデザインのURLをClaudeに渡す：

```
/wix-from-figma https://www.figma.com/design/...
```

Claude が自動で生成するもの：
- `src/mockups/<ページ名>.html` — HTMLモックアップ（視覚的仕様書）
- `docs/wix/<ページ名>-spec.md` — 実装仕様書
- `src/pages/<ページ名>.<pageId>.js` — Velo コード雛形

---

## Step 5 — デザインレビューを実行

```
/design-review src/mockups/<ページ名>.html
```

Claude がチェックシート全カテゴリを評価してレポートを出力する。
❌ 不合格項目は Claude が自動修正する。

詳細 → `docs/manuals/design-review-workflow.md`

---

## Step 6 — PR を出してマージ

```bash
node scripts/pr-up.js
```

PR マージ前に `npm test` が自動実行され、デザインチェックを含む全テストが通過することを確認する。

---

## Step 7 — Wix Studio に公開

```bash
wix publish
# → 「Latest commit from origin/main」を選択
```

---

## 案件ごとの差し替え一覧

詳細は `docs/template-vars.md` を参照。

| 項目 | ファイル | 内容 |
|---|---|---|
| ブランドカラー | `src/styles/global.css` | `--color-primary` 等 |
| フォント | `src/styles/global.css` | `--font-base` / `--font-en` |
| サイトID | `wix.config.json` | `wix dev` で自動設定 |
| ページ Velo コード | `src/pages/` | ページIDを含むファイル名 |
| ナビ要素ID | `src/pages/masterPage.js` | `#navTrialBtn` 等 |

---

## よくあるミス

**wix publish でエラーが出る**
```bash
unset GITHUB_TOKEN
wix publish
```

**Wix Editor でページが更新されない**
→ `wix publish` 後、ブラウザのキャッシュをクリアして再確認する。

**新しいページの JS ファイルが自動生成されない**
→ `src/pages/<ページ名>.<pageId>.js` を手動で作成すると `wix dev` が検知する。
ページIDは Wix Editor の URL から確認できる。
