# Wix GitHub 連携 セットアップ手順

## 概要

このドキュメントは Wix Studio サイトと GitHub リポジトリの連携を確立するための確定手順です。
別案件でも同じ手順を使い回せます。

## 前提条件

- GitHub リポジトリが存在する
- Wix Studio の対象サイトの `siteId` が確定している
- `WIX_API_KEY` が GitHub Secrets に設定済み（Settings → Secrets → `WIX_API_KEY`）

## Step 1：wix.config.json を作成する

リポジトリ直下に `wix.config.json` を作成する。

```json
{
  "siteId": "<対象サイトの siteId>",
  "uiVersion": "6"
}
```

- `siteId` は Wix Studio のダッシュボード URL から取得する
  - 例: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/` の場合、siteId は `0e9fab77-6694-464e-9f13-d5c320c88550`
- `uiVersion: "6"` は Wix CLI v1.1.x が要求するフィールド。省略すると `wix publish` が動作しない

## Step 2：Wix Velo の src/ 構造を初期化する

`wix publish` / `wix dev` は `src/` ディレクトリに Velo ファイル構造が存在することを前提とする。
この構造は手動で作成できないため、Wix Studio の GitHub Integration 経由で生成する。

### 2-1. 一時リポジトリを Wix Studio GitHub Integration で作成する

1. Wix Studio エディターを開く
2. GitHub Integration（Git Integration）を開く
3. **新規リポジトリ名**を入力して作成する（例: `my-site-init`）
   - 既存リポジトリへの直接接続はこの UI では不可
   - 一時リポジトリとして作成し、後で削除してよい
4. Wix が GitHub に `src/` 構造を含むファイルをプッシュするまで待つ

### 2-2. src/ を本リポジトリにコピーする

```bash
# 一時リポジトリをクローン
git clone https://github.com/<org>/<tmp-repo>.git /tmp/wix-init-tmp

# src/ を本リポジトリにコピー
cp -r /tmp/wix-init-tmp/src <本リポジトリのパス>/

# 確認
find <本リポジトリのパス>/src -type f
```

コピー後に存在するべきファイル（最小構成）:

```
src/
  pages/
    masterPage.js     ← 必須
    Home.c1dmp.js     ← ページコード（ページ名は案件により異なる）
    README.md
  backend/
    README.md
    permissions.json
  public/
    README.md
  styles/
    global.css
```

### 2-3. 一時リポジトリを削除する（任意）

```bash
gh repo delete <org>/<tmp-repo> --yes
```

## Step 3：動作確認

### ローカルで wix dev を試す

```bash
npx wix login --api-key <WIX_API_KEY>
npx wix dev
```

成功するとブラウザで Wix Studio ローカルエディターが開く。

### CI（GitHub Actions）で wix preview を確認する

`main` ブランチへプッシュすると `wix-preview-on-push.yml` が動作する:

```
main push
  → wix login --api-key
  → wix preview --source remote
  → プレビューURLが生成される（本番公開はしない）
```

プレビューURLは Actions のログに表示される。
本番公開（`wix publish`）は手動で行う。

## 注意事項

- `wix preview --source remote` はコードをWix Studioに反映してプレビューURLを生成する
- 本番公開はしない（ドメイン設定・課金が整ってから手動で `wix publish` を実行する）
- Wix Studio 側でビジュアル編集した内容が上書きされる場合がある
- `src/` 配下の JS ファイルは Velo（Wix の JavaScript プラットフォーム）のコード
- `wix.config.json` はコミット対象（`.gitignore` には含めない）
- `.wix/` はコミット対象外（`.gitignore` で除外済み）

## 別案件への流用

1. 新リポジトリに `wix.config.json`（`siteId` を案件に合わせて変更）をコピー
2. `src/` は同じ初期化手順（Step 2）で再生成する
3. `.github/workflows/wix-main-publish.yml` はそのままコピーして使える
