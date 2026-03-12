# Wix Connection Plan

## 現在の制約
- `npx wix init` は `wix.config.json` がない空フォルダ直結用途では失敗した
- そのため、Wix CLI の初期接続は別手順で確認し、`npx wix init` を前提に次工程を組まない

## 固定方針
- 共通土台には Wix 固有設定を入れない
- Wix 設定、接続情報、検証ページは `ryoochi-wix-site` のような案件 repo 側だけで扱う
- 当面は最小検証ページで Wix Studio 連携と編集性を確認する

## 次アクション
- Wix CLI の接続手順を案件 repo 前提で確定する
- 最小検証ページを用意し、Wix Studio 上で編集できるかを確認する
- Git / Codespaces 起点整備は完了しているため、次は Wix 本筋の接続と検証へ進む
