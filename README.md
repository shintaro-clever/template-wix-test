# ryoochi-wix-site（テンプレート基盤）

本リポジトリは Wix Studio 案件の **テンプレート基盤** です。
CI・ドキュメント・AI ルール・スクリプト等の運用資産を管理し、実働先リポジトリへ片方向でミラーして使います。

## リポジトリの役割

| リポジトリ | 役割 |
|---|---|
| **本リポジトリ**（ryoochi-wix-site） | テンプレート基盤。CI・docs・agents・scripts を管理する |
| **my-site-1** | 実働先。Wix Studio GitHub Integration が生成した Wix 連携リポジトリ |

同期方向は **テンプレート基盤 → 実働先（片方向のみ）**。`src/` と `wix.config.json` は実働先が正本であり上書きしない。

## 実働先への資産移植

```bash
git clone https://github.com/shintaro-clever/ryoochi-wix-site /tmp/ryoochi
git clone https://github.com/shintaro-clever/my-site-1 /tmp/my-site-1
bash /tmp/ryoochi/scripts/migrate-to-wix-repo.sh /tmp/my-site-1
```

詳細は `docs/wix/import-runbook.md` を参照。

## CI の目的

`main` push 時に GitHub Actions（`wix-preview-on-push`）が `wix preview` を実行し、プレビュー URL を生成します。
本番公開（`wix publish`）はドメイン設定・課金整備後に管理者が手動で行います。

## ドキュメント一覧

### Wix 連携
- セットアップ手順: `docs/wix/connection-plan.md`
- 移植 Runbook: `docs/wix/import-runbook.md`
- 成果物一覧: `docs/wix/artifact-index.md`

### 非エンジニア向け
- 立ち上げマニュアル: `docs/manuals/wix-startup-manual.md`
- チェックリスト: `docs/manuals/wix-startup-checklist.md`
- 用語集: `docs/manuals/wix-glossary.md`
- 役割分担表: `docs/manuals/who-does-what.md`
