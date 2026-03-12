# AI / GitHub Workflow Base

このリポジトリは、案件ごとの実装を載せる前段階の共通土台です。

目的:

- AI運用ルールを共通化する
- GitHub 運用の最低限テンプレートを揃える
- 案件固有実装を入れる前の軽量ベースを維持する

含むもの:

- GitHub Actions とテンプレート
- AI運用向けドキュメントの最小セット
- `agents` / `.agents` 配下の運用ルール
- 構造確認用の最小スクリプト
- Codespaces / devcontainer の最小設定

含まないもの:

- 案件固有アプリ実装
- Hub 本体実装
- Wix 固有設定
- サーバー起動コード
- 検証用 selftest 群

## 想定用途

1. この共通土台を案件用リポジトリへ複製する
2. 案件側で必要な実装のみ追加する
3. Wix 案件では複製先にだけ `wix.config.json` や Wix 関連コードを追加する

## Scripts

```bash
npm run check:structure
npm run check:sot-dup
```

## Dev Container

- Node 22 ベース
- `GITHUB_PAT_TOKEN` をローカル環境変数から受け取る
- 追加の postCreate / postStart 処理は持たない

## Notes

- このベースは軽量維持を優先します
- 案件固有の設定は複製先リポジトリで管理します
