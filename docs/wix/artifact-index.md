# Artifact Index

## 目的
- Wix 最小検証で作成した成果物を一覧化し、README から辿れるようにする
- 本制作へ進む前に、必要な文書と原型の抜け漏れを確認できるようにする

## 方針と前提
- `docs/wix/README.md`
- `docs/wix/connection-plan.md`
- `docs/wix/role-boundary.md`

## 検証仕様と判定
- `docs/wix/minimum-validation-spec.md`
- `docs/wix/editability-checklist.md`
- `docs/wix/go-no-go.md`

## 実作業 runbook
- `docs/wix/import-runbook.md`

## 実施記録
- `docs/wix/minimum-validation-run-2026-03-12.md`
  - `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` を固定済み
  - `prototype/minimum-page/` は開始条件を満たす
  - 現在の阻害要因は `Wix Studio ブラウザ側の未ログインセッション`

## 持ち込み元の原型
- `prototype/minimum-page/index.html`
- `prototype/minimum-page/styles.css`

## 最小検証完了の目安
- 接続前提が `docs/wix/connection-plan.md` に固定されている
- 役割境界が `docs/wix/role-boundary.md` に整理されている
- 最小検証仕様と判定基準が `docs/wix/minimum-validation-spec.md` と `docs/wix/go-no-go.md` にある
- 持ち込み手順と編集性観点が `docs/wix/import-runbook.md` と `docs/wix/editability-checklist.md` にある
- 実施結果と詰まり方の記録が `docs/wix/minimum-validation-run-2026-03-12.md` にある
- `site ID 不明` ではなく `Wix Studio ブラウザ側の未ログインセッション` が阻害要因として固定されている
- 再利用できる静的原型が `prototype/minimum-page/` にある
