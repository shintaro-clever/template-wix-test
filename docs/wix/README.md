# Wix Docs

このディレクトリは `ryoochi-wix-site` の Wix 関連メモと方針だけを置く。

## 方針
- Wix 関連の設定、接続メモ、検証手順はこの案件 repo 側だけで管理する
- 共通土台へ Wix 固有設定や案件接続前提を逆流させない
- 実接続前は最小検証ページを前提に、Wix Studio 連携と編集性の確認を優先する
- 検証の主目的は、案件画面を開けること自体ではなく、`GitHub main` と `Wix Studio` の連携運用が成立するかを確認すること
- 当面は GitHub 起点で送り、`GitHub main` と `Wix Studio` を連携する前提で考える
- repo 側では `.github/workflows/wix-main-publish.yml` により、`main` push 後に `wix publish` を走らせる
- ただし実動条件は、Wix Studio 側の Git Integration、repo 上の `wix.config.json`、GitHub Secrets の `WIX_API_KEY` が揃っていること
- Wix MCP は代替ラインとして有効だが、現行の Git Integration / `wix.config.json` / `WIX_API_KEY` の停止条件とは分けて扱う
- したがって、MCP が使える状態でも GitHub main 反映導線の未成立は別件として残す
- 現時点の最小検証では、`site ID 0e9fab77-6694-464e-9f13-d5c320c88550` は確定済みで、阻害要因は `Wix Studio ブラウザ側の未ログインセッション` とする
- `prototype/minimum-page/` は開始条件を満たしており、現状は prototype 欠陥ではなく Studio ブラウザ認証未到達として扱う

## 補助コマンド
- `npm run wix:help`
- `npm run wix:version`

## MCP の扱い
- MCP は、Wix 側の状態確認や AI クライアントからの補助操作に使う代替ラインとする
- MCP を使う場合でも、`GitHub main -> Wix Studio` の publish 導線そのものを置き換えたとは見なさない
- `main` マージ反映の成立条件は引き続き、Wix Studio 側の Git Integration、repo 上の `wix.config.json`、GitHub Secrets の `WIX_API_KEY` を正とする

## 推奨プロンプト規約
- 最初に `Git Integration` と `MCP` のどちらを使う話かを明記する
- 対象 `site ID` を先に書く
- 目的を `状態確認` `接続確認` `反映確認` `実装` のどれかで固定する
- Git Integration 側の停止条件と、MCP 側の停止条件を混ぜない
- 依頼文には「何を更新するか」「何は未実施のまま維持するか」を入れる

## 関連メモ
- `docs/wix/connection-plan.md`
- `docs/wix/artifact-index.md`
- `docs/wix/minimum-validation-run-2026-03-12.md`
- 非エンジニア向けの開始資料は `docs/manuals/index.md`

## 最新の実施結果
- `prototype/minimum-page/` は最小検証開始条件を満たしている
- コード反映の先行確認用に `prototype/studio-smoke/` を追加済み
- repo 側では `main` push 時の Wix publish workflow を追加済み
- 暫定判定は `方針修正`
- `方針修正` の意味は、原型修正ではなく、認証導線固定後に同じ `Hero` 検証を再実施すること
- 案件画面到達は主目的ではなく、必要に応じた確認事項として扱う
- `https://manage.wix.com/studio` と対象 dashboard URL は、3 回目の再確認でもどちらも `Sign up / Log in` 画面だった
- `WIX-STUDIO-14` と `WIX-STUDIO-15` は、案件画面到達後のみ開始する
- 詳細は `docs/wix/minimum-validation-run-2026-03-12.md` を正とする
