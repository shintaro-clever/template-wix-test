# ryoochi-wix-site（テンプレート基盤）

本リポジトリは Wix Studio 案件の **テンプレート基盤** です。
CI・ドキュメント・AI ルール・スクリプト等の運用資産を管理し、実働先リポジトリへ片方向でミラーして使います。

## リポジトリの役割（最終確定）

| リポジトリ | 役割 | 編集するもの |
|---|---|---|
| **ryoochi-wix-site**（本リポジトリ） | **テンプレート基盤** | CI・docs・agents・scripts・マニュアル |
| **my-site-1** | **実働先** | Wix Studio 上のビジュアル編集・`src/` の Velo コード |

### どの変更をどちらに入れるか

| 変更の種類 | 編集先 |
|---|---|
| CI ワークフローの修正 | ryoochi-wix-site（テンプレート）→ migrate で実働先へ反映 |
| マニュアル・ドキュメントの更新 | ryoochi-wix-site（テンプレート）→ migrate で実働先へ反映 |
| AI ルール（agents/）の更新 | ryoochi-wix-site（テンプレート）→ migrate で実働先へ反映 |
| Wix ページのビジュアル編集 | my-site-1（実働先）の Wix Studio 上で直接編集 |
| Velo コード（`src/`）の修正 | my-site-1（実働先）で直接編集。テンプレートへ持ち込まない |
| `wix.config.json` の変更 | my-site-1（実働先）のみ。テンプレートへ持ち込まない |

同期方向は **テンプレート基盤 → 実働先（片方向のみ）**。逆方向（実働先 → テンプレート）の同期は行わない。

## 新案件で差し替える値

新案件でこのテンプレートを使う際に変更が必要な変数は `docs/template-vars.md` にまとめています。
主な差し替え対象：実働先リポジトリ名・siteId・GitHub Secrets（WIX_API_KEY・NPM_TOKEN）

## 実働先への資産移植

```bash
git clone <テンプレート基盤の GitHub URL> /tmp/template
git clone <実働先の GitHub URL> /tmp/working-repo
bash /tmp/template/scripts/migrate-to-wix-repo.sh /tmp/working-repo
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
