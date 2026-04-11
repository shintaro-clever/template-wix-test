# Wix CLI コマンドリファレンス

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `wix dev` | ローカル開発環境を起動（Local Editor を開く） |
| `wix publish` | サイトを本番公開する |
| `wix preview` | 本番公開前のプレビューURLを生成する |
| `wix install <package>` | コードパッケージをインストール |
| `wix update <package>` | インストール済みパッケージを更新 |
| `wix uninstall <package>` | パッケージをアンインストール |
| `wix login` | Wixアカウントにログイン |
| `wix whoami` | ログイン中のユーザーを表示 |
| `wix logout` | Wixアカウントからログアウト |
| `wix -h` | ヘルプ表示 |

## 重要な運用ルール

### wix dev の起動
このCodespaces環境では `HOME=/tmp` が必要な場合がある：
```bash
HOME=/tmp XDG_CONFIG_HOME=/tmp npx wix dev
# または（認証済みの場合）
wix dev
```

### wix publish の選択肢
```
❯ Latest commit from origin/main  ← 通常はこちら
  Local code                       ← ローカルのみの変更を公開（GitHubと乖離するため注意）
```

### wix preview の選択肢
```
❯ Latest commit from origin/main
  Local code
```

### GitHub認証との組み合わせ
git操作前は必ず：
```bash
unset GITHUB_TOKEN && gh auth login
```

### 新ページのJSファイル同期
Figmaプラグイン等でWix側に新ページが作られた場合、
ローカルにJSファイルが自動で出現しないことがある。
その場合は手動で `src/pages/<pageName>.<pageId>.js` を作成すれば
`wix dev` が検知して同期される。

### ページファイルの命名規則
```
src/pages/<ページ名>.<ページID>.js
例: code.html.m39tf.js
```

## flags

### wix dev
| フラグ | 説明 |
|---|---|
| `--tunnel` | クラウドIDE（Codespacesなど）で接続する場合に使用 |

### wix install
| フラグ | 説明 |
|---|---|
| `--npm` | npm を強制使用 |
| `--yarn` | yarn を強制使用 |
