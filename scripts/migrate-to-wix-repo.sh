#!/usr/bin/env bash
# migrate-to-wix-repo.sh
#
# 目的:
#   テンプレート基盤（本リポジトリ）の運用資産を、実働先（Wix Studio GitHub Integration
#   が生成したリポジトリ）へ片方向でミラーする。
#   同期方向: テンプレート基盤 → 実働先（片方向のみ）
#   同期対象: CI・docs・agents・scripts など
#   非同期対象: src/・wix.config.json（Wix が生成・管理するもの。上書きしない）
#
# 使い方:
#   1. my-site-1 を手元に clone する
#      git clone https://github.com/shintaro-clever/my-site-1 /path/to/my-site-1
#   2. 本スクリプトを実行する
#      bash scripts/migrate-to-wix-repo.sh /path/to/my-site-1
#   3. my-site-1 側で差分を確認し、コミット・PR を作成する

set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-}"

# --- 引数チェック ---
if [ -z "$TARGET_DIR" ]; then
  echo "使い方: bash $0 <移植先ディレクトリ>"
  echo "例:     bash $0 /path/to/my-site-1"
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "エラー: ディレクトリが存在しません: $TARGET_DIR"
  exit 1
fi

if [ ! -f "$TARGET_DIR/wix.config.json" ]; then
  echo "エラー: wix.config.json が見つかりません。Wix 生成リポジトリを指定してください: $TARGET_DIR"
  exit 1
fi

echo "テンプレート: $TEMPLATE_DIR"
echo "移植先:       $TARGET_DIR"
echo ""

# --- 移植対象のコピー ---

copy_dir() {
  local src="$TEMPLATE_DIR/$1"
  local dst="$TARGET_DIR/$1"
  if [ -d "$src" ]; then
    echo "  コピー: $1/"
    cp -r "$src" "$TARGET_DIR/"
  else
    echo "  スキップ（存在しない）: $1/"
  fi
}

copy_file() {
  local src="$TEMPLATE_DIR/$1"
  local dst="$TARGET_DIR/$1"
  if [ -f "$src" ]; then
    echo "  コピー: $1"
    cp "$src" "$dst"
  else
    echo "  スキップ（存在しない）: $1"
  fi
}

echo "=== ディレクトリをコピー ==="
copy_dir ".github"
copy_dir "agents"
copy_dir "docs"
copy_dir "scripts"
copy_dir "prototype"
copy_dir ".devcontainer"

echo ""
echo "=== ファイルをコピー ==="
copy_file "AGENTS.md"
copy_file "CLAUDE.md"
copy_file "README.md"
copy_file "AI_DEV_POLICY.md"

# --- package.json: @wix/cli devDependency を追記（上書きしない）---
echo ""
echo "=== package.json の確認 ==="
TARGET_PKG="$TARGET_DIR/package.json"
if [ -f "$TARGET_PKG" ]; then
  if grep -q '"@wix/cli"' "$TARGET_PKG"; then
    echo "  @wix/cli は既に package.json に含まれています。スキップ。"
  else
    echo "  警告: @wix/cli が package.json にありません。手動で devDependencies に追記してください。"
    echo "  追記例: \"@wix/cli\": \"^1.1.166\""
  fi
else
  echo "  警告: package.json が移植先に存在しません。"
fi

# --- 移植しないものの明示 ---
echo ""
echo "=== 移植しないもの（Wix 生成・Wix 管理） ==="
echo "  src/           ← Wix が生成・管理する Velo 構造。上書きしない。"
echo "  wix.config.json ← 移植先の siteId を維持する。上書きしない。"
echo "  .wix/          ← CLI キャッシュ。コミット対象外。"

echo ""
echo "=== 移植完了 ==="
echo "次のステップ:"
echo "  1. cd $TARGET_DIR"
echo "  2. git status で差分を確認"
echo "  3. 問題なければ git add / git commit / git push してください"
echo "  4. GitHub Secrets に WIX_API_KEY が設定されているか確認してください"
