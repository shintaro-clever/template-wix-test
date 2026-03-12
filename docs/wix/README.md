# Wix Docs

このディレクトリはテンプレート基盤の Wix 関連ドキュメントを置く。
実働先は **Wix Studio GitHub Integration が生成したリポジトリ** とする。

## ドキュメント構成

| ファイル | 内容 |
|---|---|
| `connection-plan.md` | セットアップ手順・方針変更の記録 |
| `import-runbook.md` | テンプレート→実働先の移植手順・持ち込み手順 |
| `artifact-index.md` | 成果物一覧 |
| `minimum-validation-spec.md` | 最小検証仕様 |
| `editability-checklist.md` | 編集性確認チェックリスト |

## 方針

- 実働先は Wix Studio GitHub Integration が生成したリポジトリ。案件ごとに異なる
- テンプレート基盤の資産（CI・docs・agents 等）を実働先へ片方向でミラーする
- `src/` と `wix.config.json` は実働先が正本。テンプレート側から上書きしない
- `main` push → `wix preview --source remote` でプレビュー URL を生成する（本番公開ではない）
- 本番公開は課金・ドメイン整備後に管理者が手動で実施する
- `agents/` `.agents/` `.github/` `scripts/pr-up.js` はテンプレート運用の土台として保持する
- 案件固有の接続履歴、検証ログ、`siteId` 固定値はテンプレート側へ残しすぎない

## 補助コマンド（テンプレート側での確認用）

```bash
npm run wix:version   # Wix CLI バージョン確認
npm run wix:help      # Wix CLI ヘルプ
```
