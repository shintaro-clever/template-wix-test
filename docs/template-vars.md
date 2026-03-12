# テンプレート変数一覧

新案件でこのリポジトリをテンプレートとして使う際に差し替えが必要な値をまとめる。

## 変数一覧

| 変数名 | 説明 | 現テンプレの値（参考） | 新案件で設定する値 |
|---|---|---|---|
| `TEMPLATE_REPO_NAME` | このテンプレート基盤リポジトリ名 | `<template-repo-name>` | リネーム後のテンプレ名 |
| `TEMPLATE_REPO_URL` | テンプレート基盤の GitHub URL | `https://github.com/<org>/<template-repo-name>` | 新テンプレの URL |
| `WORKING_REPO_NAME` | 実働先リポジトリ名（Wix 生成） | `<working-repo-name>` | Wix Studio が生成したリポジトリ名 |
| `WORKING_REPO_URL` | 実働先の GitHub URL | `https://github.com/<org>/<working-repo-name>` | Wix Studio が生成したリポジトリの URL |
| `SITE_ID` | Wix サイト ID | `<siteId>`（案件ごとに異なる） | `wix.config.json` の `siteId` |
| `SITE_NAME` | Wix サイト名 / 表示名 | `<site-name>` | Wix Studio 上のサイト名 |
| `WIX_API_KEY` | Wix CLI 認証用 API キー（GitHub Secret 名） | `WIX_API_KEY`（変更不要） | Wix ダッシュボードで発行した値を Secret に設定 |
| `NPM_TOKEN` | npm レジストリ認証トークン（GitHub Secret 名） | `NPM_TOKEN`（変更不要） | npm アクセストークンを Secret に設定 |

> Secret 名（`WIX_API_KEY`・`NPM_TOKEN`）はワークフロー内で固定参照しているため、名前は変えず値のみ設定する。

---

## 差し替えが必要な箇所

### 1. Wix 生成リポジトリ側（実働先）

**`wix.config.json`**（Wix が自動生成するが確認必須）
```json
{
  "siteId": "<SITE_ID>",   ← Wix Studio GitHub Integration が生成
  "uiVersion": "6"         ← ない場合は手動追記
}
```

**GitHub Secrets**（実働先リポジトリの Settings → Secrets → Actions）

| Secret 名 | 設定値 |
|---|---|
| `WIX_API_KEY` | Wix ダッシュボードで発行した API キー |
| `NPM_TOKEN` | npm アクセストークン（CI の npm install に必要） |

---

### 2. テンプレート基盤側（このリポジトリ）

**`README.md`**
- リポジトリ名の見出し・役割説明（案件ごとに更新）

**`docs/wix/README.md`**
- 実働先リポジトリ名の参照（案件ごとに更新）

---

### 3. 案件開始時に新規作成するもの（テンプレートに含まれない）

| 成果物 | 格納先 | 説明 |
|---|---|---|
| 最小検証実施記録 | `docs/wix/archive/<日付>-validation-run.md` | 検証ごとに作成 |
| 静的原型 HTML/CSS | `prototype/minimum-page/` | 案件の素材に差し替え |

---

## 変数適用の手順（新案件開始時）

```
1. Wix Studio GitHub Integration で実働先リポジトリを生成
   → WORKING_REPO_NAME と SITE_ID が確定する

2. 実働先リポジトリに GitHub Secrets を設定
   → WIX_API_KEY（Wix ダッシュボードで発行）
   → NPM_TOKEN（npm で発行）

3. migrate-to-wix-repo.sh で運用資産を実働先へ移植
   → bash scripts/migrate-to-wix-repo.sh /path/to/<WORKING_REPO_NAME>

4. 実働先の wix.config.json に uiVersion: "6" を追記（ない場合）

5. main push → CI（wix-preview-on-push）が動くことを確認
```
