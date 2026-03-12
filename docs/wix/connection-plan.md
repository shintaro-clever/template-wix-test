# Wix GitHub 連携 セットアップ手順

## 概要

Wix Studio サイトと GitHub を連携して、コード変更を自動でプレビューできる状態を構築する手順です。

### リポジトリの役割（最終確定）

| リポジトリ | 役割 | 編集するもの |
|---|---|---|
| **テンプレート基盤** | **テンプレート基盤** | CI・docs・agents・scripts・マニュアル |
| **実働先リポジトリ** | **実働先** | Wix Studio 上のビジュアル・`src/` の Velo コード |

**どの変更をどちらに入れるか**

- CI・マニュアル・AI ルールの変更 → **テンプレート基盤** で編集し、`scripts/migrate-to-wix-repo.sh` で実働先へ反映
- Wix ページのビジュアル・`src/` コードの変更 → **実働先リポジトリ** で直接編集。テンプレートへ持ち込まない
- `wix.config.json` の変更 → **実働先リポジトリ** のみ。テンプレートへ持ち込まない

同期方向は **テンプレート基盤 → 実働先（片方向のみ）**。

## 方針変更の記録（引継ぎ用）

次担当者・次チャットへの引継ぎのために、旧方針と新方針の差分を残す。

### 主線の変化

| 観点 | 旧方針（採用しない） | 新方針（現行） |
|---|---|---|
| **リポジトリの役割** | 既存リポジトリを唯一の作業場にする | テンプレート基盤と実働先（Wix 生成 Repo）を分離する |
| **src/ の調達** | テンプレート側から `src/` をコピーして実働先へ持ち込む | 実働先の Wix 自動生成 `src/` をそのまま維持する |
| **資産の同期方向** | Wix 構造をテンプレート側に合わせようとした（双方向） | テンプレート基盤 → 実働先への片方向ミラーのみ |
| **CI コマンド** | `wix publish --approve-preview`（本番公開を想定） | `wix preview --source remote`（プレビュー URL 生成のみ） |
| **連携の仕組み** | Wix 側が認識しないリポジトリへ接続しようとした | 実働先（Wix 生成 Repo）で `--source remote` が正しく機能する |

### 変更の背景（一文）

`wix preview --source remote` は Wix が認識しているリポジトリの `main` を参照するため、既存リポジトリを母体にした場合は変更が Wix 側に届かず、CI が成功してもデザインが反映されないという破綻が確認されたため。

### この記録で言いたいこと

**「テンプレート基盤と実働先を同一リポジトリにする」ではなく「テンプレート基盤の資産を実働先（Wix 生成 Repo）へ片方向でミラーする」が現行の主線である。**
今後この方向を逆に戻す変更（テンプレート側を実働先に統合する、`src/` をコピーで差し替える）は採用しない。

---

### なぜこの方針か（3 行要約）

1. **Wix CLI / Studio が期待する構造の正本は実働先（Wix 生成リポジトリ）にある** — `src/` や `wix.config.json` は Wix が生成・管理するものであり、手動作成やテンプレート側からのコピーでは CLI が起動しない。
2. **テンプレート側を実働先として使おうとするより破綻しにくい** — テンプレート側を実働先として使うと、`wix preview --source remote` は Wix が認識しているリポジトリ（実働先）を参照するため、テンプレート側の変更が Wix 側に届かない「静かな不整合」が起きる。
3. **障害切り分けがしやすい** — Wix 生成リポジトリを実働先とすると、`src/` 関連は Wix 側・CI や Secrets はテンプレート側、と責任領域が分かれる。詳細は後述。

```
全体の流れ
  Step 1: Wix Studio GitHub Integration → リポジトリ生成（src/ が自動生成される）
  Step 2: 生成リポジトリに GitHub 運用資産を移植
  Step 3: CI 動作確認（main push → wix preview）
```

---

## Step 1：Wix Studio GitHub Integration でリポジトリを生成する

Wix Studio の GitHub Integration を使ってリポジトリを生成します。
Wix が `src/`（Velo ファイル構造）と `wix.config.json` を自動生成・プッシュします。

### 手順

1. Wix Studio エディターを開く
2. GitHub Integration（Git Integration）を開く
3. 新規リポジトリ名を入力して作成する
4. Wix が GitHub にファイルをプッシュするまで待つ

### 生成後に確認するファイル

```
<生成リポジトリ>/
  wix.config.json          ← Wix が自動生成（siteId を含む）
  src/
    pages/
      masterPage.js        ← 必須
      Home.c1dmp.js        ← ページコード（名前は案件により異なる）
    backend/
      permissions.json
    styles/
      global.css
    public/
```

### wix.config.json の確認

Wix が生成した `wix.config.json` に `uiVersion` がない場合は追記する。

```json
{
  "siteId": "<自動生成された siteId>",
  "uiVersion": "6"
}
```

### なぜ Wix 生成リポジトリを起点にするか（詳細）

**理由 1：Wix CLI / Studio が期待する構造の正本が Wix 生成側にある**

Wix CLI は `src/pages/masterPage.js` を含む Velo コード構造を前提として動作します。この構造は Wix Studio GitHub Integration が自動生成するものです。手動で `src/` を作成したり、別リポジトリからファイルをコピーしたりすると、CLI が `ENOENT: no such file or directory, scandir '...src'` エラーを出して起動しません。`wix.config.json` に含まれる `siteId` も Wix が発行するものであり、こちら側で用意できる値ではありません。

**理由 2：テンプレート側を実働先として使おうとするより破綻しにくい**

`wix preview --source remote` は「Wix が GitHub Integration で認識しているリポジトリの `main` ブランチ」を参照します。テンプレート基盤を実働先として使おうとした場合、Wix が認識しているのは自身が生成した実働先リポジトリであるため、テンプレート基盤への変更は Wix 側に届きません。CI は成功するのにデザインが反映されないという、原因が見えない破綻が起きます。実働先リポジトリを分離することで、この問題を構造的に排除します。

**理由 3：障害切り分けがしやすい**

| 症状 | 原因の所在 |
|---|---|
| `src/` 構造エラー・ページ未検出 | Wix 生成物の問題（触るべきでなかった） |
| CI 失敗・プレビューURL 未生成 | こちら側（Secrets・ワークフロー・package.json） |
| デザイン変更が反映されない | 実働先（Wix 生成リポジトリ）ではなくテンプレート側を編集している |

Wix 生成リポジトリを実働先として使うと、上記 3 パターンのどれに当たるかが即座に判断できます。

---

## Step 2：生成リポジトリに GitHub 運用資産を移植する

Wix が生成したリポジトリはコードのみのシンプルな構成です。
ここに CI・ドキュメント・AI 管理ルールなどを追加します。

### 移植するもの

| 資産 | 内容 |
|---|---|
| `.github/workflows/wix-preview-on-push.yml` | main push → `wix preview --source remote` |
| `agents/` | AI エージェント行動規範（SoT） |
| `docs/` | Wix 連携ドキュメント・マニュアル |
| `scripts/` | PR 自動化スクリプト |
| `prototype/` | 静的 HTML 原型 |
| `AGENTS.md`, `CLAUDE.md` | AI 向けルールの入口 |
| `package.json` | `@wix/cli` devDependency を追加 |
| `.devcontainer/` | Codespaces 設定 |

### GitHub Secrets の設定

生成リポジトリの Settings → Secrets → Actions に追加する。

| シークレット名 | 内容 |
|---|---|
| `WIX_API_KEY` | Wix ダッシュボードで発行した API キー |

### CI ワークフロー（移植内容）

```yaml
# .github/workflows/wix-preview-on-push.yml（主要部分）
- name: Login to Wix CLI
  run: npx wix login --api-key "$WIX_API_KEY"

- name: Create Wix preview from main
  run: npx wix preview --source remote
```

`--source remote` = Wix が認識しているこのリポジトリの `main` ブランチを参照します。
Wix 生成リポジトリを使っているため、これが正しく機能します。

---

## Step 3：CI 動作確認

### ローカルで動作確認する（任意）

```bash
npx wix login --api-key <WIX_API_KEY>
npx wix dev
```

成功するとブラウザで Wix Studio ローカルエディターが開く。

### CI（GitHub Actions）で確認する

`main` ブランチへコミットをプッシュする。

```
main push
  → wix login --api-key
  → wix preview --source remote
  → ✔ Your preview deployment is now available at https://wix.to/xxxxx
```

Actions のログにプレビューURLが表示されれば連携完了。

---

## 注意事項

- `wix preview --source remote` は本番公開をしない（プレビューURLのみ生成）
- 本番公開（`wix publish`）はドメイン設定・課金が整った後に手動で行う
- `wix.config.json` はコミット対象（`.gitignore` には含めない）
- `.wix/` はコミット対象外（`.gitignore` で除外済み）
- Wix Studio 側でビジュアル編集した内容と、`src/` のコードは独立して管理される

---

## 過去の誤認ポイントと再発防止メモ

同じ失敗を繰り返さないための記録。事実のみを残す。

### 1. `uiVersion: "6"` は手動追記が必要な場合がある

Wix Studio GitHub Integration が生成する `wix.config.json` には `uiVersion` フィールドが含まれないことがある。この状態では CLI が正常に動作しない。生成直後に `uiVersion: "6"` を追記してコミットすること。

```json
{
  "siteId": "<Wix が生成した値>",
  "uiVersion": "6"
}
```

### 2. `--source` オプションは `wix preview` 専用

`wix publish --source remote` と入力すると `unknown option '--source'` エラーになる。`--source` フラグは `wix preview` にのみ存在する。`wix publish` には `--source` がない。

### 3. `src/` は手動再現が困難

`src/pages/masterPage.js` を手動作成したり別リポジトリからコピーしたりしても、Wix CLI が期待する構造と一致しないことがある。この状態で `wix dev` や `wix preview` を実行すると `ENOENT: no such file or directory, scandir '...src'` エラーが発生し起動しない。`src/` は必ず Wix Studio GitHub Integration が生成したものを使う。

### 4. 既存リポジトリへの直接接続はできない

Wix Studio GitHub Integration は自身が生成したリポジトリにのみ接続できる。既存リポジトリに `src/` や `wix.config.json` をコピーしても、Wix 側はそのリポジトリを認識しない。`wix preview --source remote` は Wix が認識しているリポジトリの `main` ブランチを参照するため、別リポジトリへの変更は Wix 側に届かない。CI が成功するのにデザインが反映されないという症状が出る。

### 5. 非TTY環境での `wix publish` は実際には公開されない

CI（非TTY環境）で `wix publish` を実行すると「Remote / Local code を選択してください」というインタラクティブメニューが表示される。入力待ちのまま処理が止まり、タイムアウト後に exit code 0 で終了する。**実際には公開されていない。** `printf '\n' | npx wix publish` で入力を送り込む回避策もあるが、現在は `wix preview` に切り替えているため不要。

---

## 別案件への流用

新規案件でも手順は同じ。

1. **Step 1**：Wix Studio GitHub Integration で案件ごとに新しいリポジトリを生成する
2. **Step 2**：前回の移植済みリポジトリをテンプレートとして運用資産をコピーする
3. **Step 3**：`WIX_API_KEY` を新リポジトリの Secrets に設定して CI 確認

> **非推奨（過去の試行）**：既存リポジトリに `src/` だけをコピーして連携しようとした手順は機能しません。
> Wix は自身が生成したリポジトリしか認識しないためです。この方法は採用しないでください。
