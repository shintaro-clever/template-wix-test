# AGENTS.md

## PR Up（「PRあげてください」運用）

タスク完了後は必ず以下を実行する：

```
node scripts/pr-up.js
```

このスクリプトが以下をすべて自動処理する：
- `npm test`
- `scripts/gen-pr-body.js` → `/tmp/pr.md` 生成
- `git push`
- `gh pr create` または `gh pr edit`

## ブランチ命名規則

`issue-<番号>-<スラッグ>` 形式にすること。  
例: `issue-42-ms0-schema`

main/master での実行は拒否される。必ず feature ブランチで作業すること。

## PR作成後のローカル後始末

```bash
git checkout main
git pull origin main
git branch -d <作業ブランチ名>
```

次のタスクは最新の main から新しいブランチを切って始める：

```bash
git checkout -b issue-<番号>-<スラッグ>
```

## stash pop 後の確認

`git stash pop` を実行した後は必ず以下を確認してからコミットする：

```bash
git status
```

`Unmerged paths` が表示された場合はコンフリクトを解消してから `git add` する。

## ネットワーク障害時のフォールバック

`git push` または `gh pr create` が失敗した場合、スクリプトがコピペ可能なコマンドを出力する。
その場合はネットワーク可のターミナルで出力されたコマンドを実行すること。

## 失敗時のルール

- 推測で原因を書かない
- 失敗したコマンドと stderr 末尾をそのまま返す

## 禁止事項

- `.github/PULL_REQUEST_TEMPLATE.md` のプレースホルダー文字列を変更しないこと  
  （`gen-pr-body.js` の正規表現が壊れる）
- `/tmp/pr.md` を手動編集しないこと（上書きされる）

## Codex の起動方法

必ず以下のエイリアスが設定された状態で起動すること（~/.bashrc に設定済み）：
```bash
alias codex='codex --sandbox=workspace-write'
```

### サンドボックスモードの選択理由
- `workspace-write`: ワークスペース内の読み書き＋ネットワークアクセスを許可。ワークスペース外のファイル操作は制限される。**通常運用はこれを使う。**
- `danger-full-access`: 全操作無制限。セキュリティリスクが高いため使用禁止。

### 禁則事項
- `--dangerously-bypass-approvals-and-sandbox` オプションは使用禁止
- `--sandbox=danger-full-access` は使用禁止
- Codex に `rm -rf` を含む破壊的コマンドを単体で指示しない
- Codex にシークレット（APIキー・トークン）を直接渡さない
- `.env` ファイルや `auth.json` の内容を Codex に表示させない
