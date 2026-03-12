# Wix Import Runbook

## 目的
- `prototype/minimum-page/` の静的 HTML/CSS を、Wix Studio 案件へ持ち込むときの手順を固定する
- CLI でやることと Studio 側でやることを分け、毎回の迷いを減らす

## 1. 準備

### repo 側で準備するもの
- `prototype/minimum-page/index.html`
- `prototype/minimum-page/styles.css`
- `docs/wix/minimum-validation-spec.md`
- `docs/wix/editability-checklist.md`

### CLI でやること
- `npm run wix:version` で CLI が呼び出せることを確認する
- 案件 repo 側の prototype と docs を最新化する
- 持ち込み対象を「本番全体ではなく最小 1 ページまたは 1 セクション」と再確認する

### Studio 側でやること
- 持ち込み先の Wix Studio 案件を開く
- 検証用のページまたはセクションを追加できる状態か確認する

## 2. 持ち込み前確認

### CLI で確認すること
- HTML が Hero、Overview、Explanation、CTA、Footer に分かれている
- テキスト差し替え箇所、画像プレースホルダ、CTA が prototype 上で独立している
- 余計な JS を入れていない

### Studio 側で確認すること
- 既存本番ページを直接壊さない導線で検証できる
- 検証対象を別ページまたは限定セクションとして扱える

## 3. 持ち込み

### CLI でやること
- 持ち込み元は `prototype/minimum-page/` を正とする
- 必要ならテキスト、画像、CTA 文言のプレースホルダを整理する
- CLI は接続確認や補助確認に留め、Wix Studio の画面構成そのものを完成させる前提にしない

### Studio 側でやること
- 静的原型を見ながら、Wix Studio 上に最小ページまたは最小セクションを再構成する
- 先にレイアウトとブロック構造を作り、その後にテキスト、画像、CTA を配置する
- 持ち込み対象は最小単位に限定し、本番 LP 全体へ一気に広げない

## 4. Wix 側での確認

### Studio 側で確認すること
- Hero、説明、CTA、画像領域、Footer が分離されたまま再現できているか
- 見出し、本文、画像、CTA を個別に選択して編集できるか
- レイアウト調整時に他セクションへ影響が広がりすぎないか

### CLI でやらないこと
- Studio 上の最終レイアウト調整
- セクション順入替や細かな編集操作
- 本番ページ全体への即時展開

## 5. 編集性確認

### Studio 側で確認すること
- テキスト差し替え: 見出しと本文を別々に修正できる
- 画像差し替え: 画像領域を差し替えても隣接構造が壊れない
- セクション順変更: Hero、Overview、Explanation、CTA の順序を調整しやすい
- CTA 変更: 文言とリンク先を独立して変更できる

### 参照ドキュメント
- `docs/wix/minimum-validation-spec.md`
- `docs/wix/editability-checklist.md`

## 6. 失敗時の切り分け

### CLI 側の問題として切り分けるもの
- Wix CLI が呼び出せない
- 案件 repo 側の prototype や docs が不整合
- 持ち込み元ファイルの構造自体が崩れている

### Studio 側の問題として切り分けるもの
- ブロック化した後に編集しづらい
- 画像差し替えや CTA 変更で構造が壊れる
- セクション順変更時に想定外のレイアウト崩れが起きる

### 再試行の順番
- まず prototype 側の構造を見直す
- 次に Wix Studio 上のブロック分けを見直す
- 最後に、検証対象をさらに小さくして再持ち込みする
