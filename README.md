# ryoochi-wix-site

株式会社リョーチ様向けの Wix Studio サイト構築用リポジトリです。

## 目的
- Wix Studio 連携用の案件リポジトリとして使用する
- AIで初期構成を作成し、最終的にWix Studio上で調整する
- 共通土台から案件固有設定だけを追加して運用する

## Wix 連携前提
- `npx wix init` は `wix.config.json` がない空フォルダ直結用途では失敗したため、初期接続の入口として固定しない
- 共通土台には Wix 固有設定を入れず、Wix 設定と接続作業は案件 repo 側だけで扱う
- 当面は最小検証ページで Wix Studio 連携と編集性を確認し、その後に実案件ページへ広げる
- Git / Codespaces 起点の整備は完了しており、次は Wix 接続と検証ページ作成の本筋へ進む

## GitHub main 反映前提
- 反映の主軸は `GitHub main` と `Wix Studio` の Git Integration を使う
- Wix 側の editor code は default branch 連携を前提に扱い、この repo 側では `main` push 後に publish を走らせる
- repo 側の自動 publish は `.github/workflows/wix-main-publish.yml` で行う
- 実動条件は、Wix Studio 側でこの repo を Git Integration 済みにし、repo に `wix.config.json` が存在し、GitHub Secrets に `WIX_API_KEY` が設定されていること
- 現時点では Git Integration は未成立で、repo に `wix.config.json` はまだ存在しない
- GitHub Secrets の `WIX_API_KEY` は設定済み
- 最新確認時点でも `.wix/debug.log` のみが存在し、Git Integration 完了後に期待する `wix.config.json` は未生成のまま
- 最新の Studio 再確認でも対象案件画面には未到達で、Git Integration 接続成立は未確認のまま

## Wix 検証成果物
- 成果物一覧: `docs/wix/artifact-index.md`
- 接続前提: `docs/wix/connection-plan.md`
- 最小検証仕様: `docs/wix/minimum-validation-spec.md`
- 持ち込み手順: `docs/wix/import-runbook.md`
- 役割境界: `docs/wix/role-boundary.md`
- 判定基準: `docs/wix/go-no-go.md`
- 静的原型: `prototype/minimum-page/index.html`

詳細は `docs/wix/artifact-index.md` を参照。

## 立ち上げマニュアルの位置づけ
- 立ち上げマニュアルは非エンジニア向けの運用文書として扱う
- 目的は、案件開始時の準備、確認、依頼先判断を迷わず進めること
- CLI や Git の詳細手順は本文の主役にせず、必要時は管理者確認へ回す

## 非エンジニア向け資料
- 一覧: `docs/manuals/index.md`
- 立ち上げマニュアル本体: `docs/manuals/wix-startup-manual.md`
- 開始時チェックリスト: `docs/manuals/wix-startup-checklist.md`
- 用語集: `docs/manuals/wix-glossary.md`
- 役割分担表: `docs/manuals/who-does-what.md`
- 困ったときの見方: `docs/manuals/troubleshooting-for-nonengineers.md`

詳細は `docs/manuals/index.md` を参照。
