# デザインレビュー & Wix反映ワークフロー マニュアル

このマニュアルでは、デザインチェックシートを使ってサイトの品質を保ちながら
Figma → モックアップ → Wix Studio へ反映するまでの一連の操作を説明します。

---

## 全体の流れ

```
Figma デザイン
    ↓  /wix-from-figma <URL>  （Claude が実行）
HTMLモックアップ生成
    ↓  /design-review <ファイル>  （Claude が実行）
デザインチェックレポート出力
    ↓  Claude がコード修正
global.css / Veloコード 更新
    ↓  PR → マージ
    ↓  wix publish
Wix Studio に反映
    ↓
デザイナーが Wix Editor で仕上げ
```

---

## 各ステップの詳細

### Step 1 — Figmaからモックアップ生成

FigmaデザインのURLをClaudeに渡す：

```
/wix-from-figma https://www.figma.com/design/...
```

Claude が行うこと：
- FigmaのデザインをMCPで読み取り
- `src/mockups/<ページ名>.html` にHTMLモックアップを生成
- `docs/wix/` に実装仕様書を生成
- `src/pages/<ページ名>.<pageId>.js` にVeloコードを生成

---

### Step 2 — デザインチェックを実行

#### 自動検証（CSS Token チェック）

```bash
npm run check:design
```

`src/styles/global.css` のトークン値をチェックシート基準と照合する。
以下を自動検証：
- フォントサイズ H1〜P3 が基準範囲内か
- セクションパディングが 50〜100px か
- メインカラーが3種類以下か

**PRを出すたびに自動実行される（CI組み込み済み）。**

#### AIレビュー（目視チェック）

```
/design-review src/mockups/<ファイル名>.html
```

Claude が行うこと：
- チェックリスト全カテゴリを評価（✅ / ⚠️ / ❌ / 確認不可）
- 不合格項目に対して具体的な修正コードを提示
- 修正後に再評価して合格を確認

---

### Step 3 — コードを修正

Claude がコードで修正できる項目（例）：

| 項目 | ファイル |
|---|---|
| フォントサイズ・カラートークン | `src/styles/global.css` |
| ホバー・フォーカス・エラーステート | `src/styles/global.css` |
| コンテンツ幅・セクション余白 | `src/mockups/*.html` → `global.css` |
| レスポンシブブレイクポイント | `src/mockups/*.html` → Wix Editor |
| フォームバリデーション | `src/pages/<pageId>.js` |
| ナビゲーション挙動 | `src/pages/masterPage.js` |

**Wix Editor での作業が必要な項目：**
- 実際のレイアウト・カラム配置
- 画像・動画のアップロード
- アニメーション設定
- レスポンシブ表示の調整（Wixのブレイクポイントビュー）
- フォントの読み込み設定

---

### Step 4 — PR を出してマージ

```bash
node scripts/pr-up.js
```

PR作成前に `npm test` が自動実行され、デザインチェックを含む全テストが通過することを確認する。

---

### Step 5 — Wix Studio に公開

```bash
wix publish
```

選択肢が出たら **「Latest commit from origin/main」** を選ぶ：

```
❯ Latest commit from origin/main  ← これを選ぶ
  Local code
```

> **注意**: ローカルのコードが main にマージされていない場合は先にマージしてから実行する。

---

## Claude によるレイアウト制御の範囲

Wix Studio におけるレイアウト操作は「構造」と「スタイル」で扱いが異なる。

### ✅ Claude がコードで制御できる

| 操作 | 方法 |
|---|---|
| 要素の表示・非表示 | Velo: `$w('#el').show()` / `.hide()` |
| スマホ/PC 判定で切り替え | Velo: `wixWindow.formFactor` で分岐 |
| スクロール連動（固定ナビ等） | Velo: `wixWindow.onScrollPageTo` |
| 色・フォント・余白・ホバー | `global.css` にクラスを追加 |
| グリッド・フレックスレイアウト | `global.css` に定義 ＋ Wix Editor でクラスを割り当てる（1回だけ手作業） |
| フォームバリデーション・送信処理 | Velo: `src/pages/<pageId>.js` |

### ❌ Wix Editor の操作が必須

| 操作 | 理由 |
|---|---|
| 新しいセクション・カラムの追加 | Wix のページ構造はコードから生成できない |
| 要素を別コンテナへ移動 | GUI ドラッグ操作のみ |
| ブレイクポイントごとの配置調整 | Wix Editor のレスポンシブビューで設定 |
| 画像・動画のアップロード | Wix メディアマネージャーで設定 |
| アニメーション設定 | Wix Editor のインタラクションパネルで設定 |
| フォント読み込み | Wix Editor のフォントパネルで設定 |

### 推奨の役割分担

```
Figma to Wix Studio プラグイン
    → デザイナーがレイアウト構造をインポート（1回）

Claude
    → global.css で色・フォント・ホバー・ステートを整備
    → Velo で動的挙動・フォーム・CMS連携を実装

デザイナー
    → Wix Editor でブレイクポイント調整・画像差し替え・仕上げ
```

> **ポイント**: デザイナーが Wix Editor で要素に CSS クラスを割り当てれば、
> それ以降のスタイル変更はすべて Claude が `global.css` で対応できる。

---

## ファイル構成の対応関係

| リポジトリのファイル | Wix での役割 |
|---|---|
| `src/styles/global.css` | 全ページ共通のCSSクラス・トークン |
| `src/pages/masterPage.js` | 全ページ共通のVeloコード |
| `src/pages/<name>.<id>.js` | 各ページのVeloコード |
| `src/mockups/*.html` | **参照用モックアップ（Wixには直接反映されない）** |
| `src/public/templates/*.js` | Veloコードのテンプレート集 |

> `src/mockups/` のHTMLは視覚的な仕様書として使う。
> 実際のWixページはWix Editor上でデザイナーが組み立てる。

---

## デザインチェックシート チェック基準（主要項目）

詳細は `agents/rules/60-design-quality.md` を参照。

### レスポンシブ基準

| デバイス | コンテンツ幅 | セクション上下 |
|---|---|---|
| デスクトップ（1512px） | 1,200〜1,412 px | 100〜50 px |
| タブレット（768px） | 〜92% | 70〜40 px |
| スマートフォン（390px） | 92%〜 | 50〜30 px |

### フォントサイズ基準（デスクトップ）

| H1 | H2 | P1 |
|---|---|---|
| 30〜40 px | 26〜30 px | 14〜16 px |

---

## よくある質問

**Q: モックアップを修正したのにWixに反映されない**
A: `src/mockups/*.html` はWixに直接反映されません。修正内容を `global.css` または Veloコードに反映してから `wix publish` を実行してください。

**Q: `wix publish` でエラーが出る**
A: `unset GITHUB_TOKEN` を先に実行してから再試行してください。認証が切れている場合は `gh auth login` で再認証が必要です。

**Q: デザインチェックでフォントサイズが「確認不可」になる**
A: `global.css` に `--font-size-h1` 等のトークンが定義されていない場合に発生します。`src/styles/global.css` の `:root` にトークンを追加してください。
