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

## Wix 検証成果物
- 成果物一覧: `docs/wix/artifact-index.md`
- 接続前提: `docs/wix/connection-plan.md`
- 最小検証仕様: `docs/wix/minimum-validation-spec.md`
- 持ち込み手順: `docs/wix/import-runbook.md`
- 役割境界: `docs/wix/role-boundary.md`
- 判定基準: `docs/wix/go-no-go.md`
- 静的原型: `prototype/minimum-page/index.html`

詳細は `docs/wix/artifact-index.md` を参照。
