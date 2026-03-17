# 45-shell-patterns — 非対話シェルパターン

## 原則

`$()` command substitution を **本文・JSON 渡しに使わない**。
ヒアドキュメントや複雑な文字列展開が必要な場合は一時ファイルを経由して渡す。

理由: `$()` を含む複合コマンドは確認プロンプトを誘発しやすく、非対話実行が壊れる。

---

## 雛形 1 — git commit メッセージ

```bash
cat > /tmp/commit-msg.txt << 'EOF'
feat(X): 変更内容の要約

詳細説明（任意）

Closes #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
git commit -F /tmp/commit-msg.txt
```

---

## 雛形 2 — gh コマンドの本文（issue / PR）

```bash
cat > /tmp/gh-body.md << 'EOF'
本文をここに書く
EOF

# Issue コメント
gh issue comment N --body-file /tmp/gh-body.md

# PR 本文（pr-up.js が使えない例外時のみ）
gh pr create --title "タイトル" --body-file /tmp/gh-body.md
```

---

## 雛形 3 — GAS curl（JSON ペイロード）

apiKey は環境変数から注入する。ヒアドキュメント内には書かない。

```bash
source /home/hubapp/.env.shared

cat > /tmp/gas-payload.json << 'EOF'
{"action":"ACTION_NAME","apiKey":"__KEY__","payload":{"TaskID":"X","Issue":N,"Repo":"repo-name"}}
EOF

python3 - << 'PY'
import json, os
with open('/tmp/gas-payload.json') as f: d = json.load(f)
d['apiKey'] = os.environ['GAS_API_KEY']
with open('/tmp/gas-payload.json', 'w') as f: json.dump(d, f)
PY

curl -s -o /tmp/gas-res.txt -D /tmp/gas-head.txt \
  -X POST "$GAS_WEBAPP_URL" -H "Content-Type: application/json" \
  -d @/tmp/gas-payload.json --max-time 15
REDIRECT=$(grep -i "^location:" /tmp/gas-head.txt | tr -d '\r' | sed 's/location: //i')
curl -s "$REDIRECT" --max-time 15
```

---

## 適用範囲

- すべてのリポジトリ・すべてのスクリプト・Skills
- 対象操作: `git commit`, `gh issue comment`, `gh pr comment`, `gh pr create`, GAS curl
- 例外: `REDIRECT=$(grep ...)` のような単純な文字列抽出は `$()` を使ってよい
