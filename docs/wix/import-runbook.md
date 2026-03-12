# Wix Import Runbook

## 目的
- `prototype/minimum-page/` の静的 HTML/CSS を、Wix Studio 案件へ持ち込むときの手順を固定する
- CLI でやることと Studio 側でやることを分け、毎回の迷いを減らす
- GitHub ↔ Wix 連携の技術セットアップ（Step 0）を先に完了してから持ち込み作業に入る

## 0. 技術セットアップ（初回のみ・別案件でも同じ手順）

GitHub ↔ Wix 連携が未設定の場合、先に以下を完了する。
詳細は `docs/wix/connection-plan.md` を参照。

### チェックリスト
- `wix.config.json` がリポジトリ直下にあり `siteId` と `uiVersion: "6"` が設定されている
- GitHub Secrets に `WIX_API_KEY` が設定されている
- `src/` ディレクトリが存在し `src/pages/masterPage.js` が含まれている
- `main` push → `wix publish --approve-preview` の CI が通ることを確認済み

### src/ がない場合の初期化手順（要点のみ）
1. Wix Studio GitHub Integration で一時リポジトリ（例: `my-site-init`）を作成
2. 生成された `src/` を本リポジトリにコピー: `cp -r /tmp/wix-init-tmp/src ./`
3. コミット・PR・main マージ → CI で動作確認

## 1. Studio ブラウザでログイン状態確認

### Studio 側でやること
- Wix Studio にログイン済みか確認する
- `Sign up / Log in` 画面ではなく、案件一覧または案件画面へ進めることを確認する
- 現時点の阻害要因は `Wix Studio ブラウザ側の未ログインセッション` であると認識する

### 認証通過の定義
- Wix Studio 認証が通ったと見なす条件は、対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が実際に表示されること
- `Sign up / Log in` 画面でないだけでは認証通過としない
- ログイン画面以外であっても、対象案件画面に未到達なら未通過として扱う

### CLI で補助確認すること
- 必要なら `npm run wix:version` で CLI が呼び出せることを確認する
- 必要なら `HOME=/tmp XDG_CONFIG_HOME=/tmp npx wix whoami` で CLI ログイン状態を確認する

## 2. 対象 URL 到達確認

### 固定対象
- 対象 URL は `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
- 対象 `site ID` は `0e9fab77-6694-464e-9f13-d5c320c88550`

### Studio 側でやること
- 上記 URL を開き、対象案件へ到達できるか確認する
- URL を開いてもログイン画面へ戻る場合は、prototype 側ではなく認証導線の問題として扱う
- ログイン画面以外へ遷移しても、対象 `site ID` の案件画面が表示されない限り認証通過扱いにしない

## 3. 案件画面表示確認

### Studio 側で確認すること
- 対象案件の dashboard または編集画面が表示される
- 検証用のページまたは限定セクションを扱える状態にある
- 既存本番ページを直接壊さない導線で検証できる

### この段階でやらないこと
- prototype の再修正を先に始めること
- 本番 LP 全体へ広げること

## 4. Hero 再構成開始

### repo 側で準備するもの
- `prototype/minimum-page/index.html`
- `prototype/minimum-page/styles.css`
- `prototype/studio-smoke/index.html`
- `prototype/studio-smoke/styles.css`
- `docs/wix/minimum-validation-spec.md`
- `docs/wix/editability-checklist.md`

### CLI で確認すること
- HTML が Hero、Overview、Explanation、CTA、Footer に分かれている
- テキスト差し替え箇所、画像プレースホルダ、CTA が prototype 上で独立している
- 余計な JS を入れていない
- `prototype/minimum-page/` は最小検証開始条件を満たしており、再修正を先に行う前提ではない
- 反映確認だけを先に行う場合は `prototype/studio-smoke/` の `h1 + p + button` 断片を使う

### Studio 側で確認すること
- 検証対象を別ページまたは限定セクションとして扱える
- 今回の対象は本番全体ではなく `Hero` である

### 案件画面到達後の最小手順
1. `Hero` だけを検証対象として開き、他セクションへ広げない
2. `prototype/minimum-page/` を見ながら、見出し、本文、画像、CTA の 4 要素で Hero の骨組みを置く
3. Hero の見出しと本文を差し替え、画像を 1 回差し替える
4. CTA 文言とリンク先を変更し、Hero 単位で選択と再調整ができるか確認する
5. そのまま `docs/wix/editability-checklist.md` に沿って編集性確認へ進む

## 5. 持ち込み

### CLI でやること
- 持ち込み元は `prototype/minimum-page/` を正とする
- 必要ならテキスト、画像、CTA 文言のプレースホルダを整理する
- CLI は接続確認や補助確認に留め、Wix Studio の画面構成そのものを完成させる前提にしない

### Studio 側でやること
- 静的原型を見ながら、Wix Studio 上に最小ページまたは最小セクションを再構成する
- 先にレイアウトとブロック構造を作り、その後にテキスト、画像、CTA を配置する
- 持ち込み対象は最小単位に限定し、本番 LP 全体へ一気に広げない
- 案件画面到達直後は、上記の最小手順どおり `Hero` のみを再構成する

## 6. Wix 側での確認

### Studio 側で確認すること
- Hero、説明、CTA、画像領域、Footer が分離されたまま再現できているか
- 見出し、本文、画像、CTA を個別に選択して編集できるか
- レイアウト調整時に他セクションへ影響が広がりすぎないか

### CLI でやらないこと
- Studio 上の最終レイアウト調整
- セクション順入替や細かな編集操作
- 本番ページ全体への即時展開

## 7. 編集性確認

### Studio 側で確認すること
- テキスト差し替え: 見出しと本文を別々に修正できる
- 画像差し替え: 画像領域を差し替えても隣接構造が壊れない
- セクション順変更: Hero、Overview、Explanation、CTA の順序を調整しやすい
- CTA 変更: 文言とリンク先を独立して変更できる

### 参照ドキュメント
- `docs/wix/minimum-validation-spec.md`
- `docs/wix/editability-checklist.md`

## 8. 失敗時の切り分け

### CLI 側の問題として切り分けるもの
- Wix CLI が呼び出せない
- 案件 repo 側の prototype や docs が不整合
- 持ち込み元ファイルの構造自体が崩れている

### Studio 側の問題として切り分けるもの
- ブラウザで Wix Studio にログインできない
- 対象 URL を開いても案件画面ではなくログイン画面に戻る
- 案件画面に入る前に止まる
- ブロック化した後に編集しづらい
- 画像差し替えや CTA 変更で構造が壊れる
- セクション順変更時に想定外のレイアウト崩れが起きる

### 再試行の順番
- まず Studio ブラウザのログイン状態を見直す
- 次に対象 URL から案件画面へ入れるか確認する
- その後に Hero の再構成へ進む
- prototype 側の見直しは、案件画面へ入れてから必要性が出た場合にだけ行う
