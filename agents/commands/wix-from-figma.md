---
description: "FigmaデザインをMCPで読み取り、Wix実装仕様とVeloコードを生成する"
arguments:
  - name: "figma_url"
    description: "FigmaデザインファイルのURL"
    required: true
  - name: "target"
    description: "生成対象（spec / velo / all）デフォルト: all"
    required: false
mode: "workspace-write"
output_language: "ja"
---

# wix-from-figma

## Purpose
FigmaデザインをMCP経由で読み取り、以下を生成する：
1. Wix Studio実装仕様書（セクション・要素・ID定義）
2. テキストコンテンツ（コピー）
3. Veloコード（フォーム・動的処理）

## References
- `@docs/wix/figma-wireframe-workflow.md`
- `@src/public/templates/`
- `@.github/PULL_REQUEST_TEMPLATE.md`

## Flow

### 1. Figma読み取り
```
1. URLからfileKeyとnodeIdを抽出
2. get_metadata で全ページ一覧を確認
3. 対象ページに get_design_context を実行
4. get_screenshot でビジュアルを確認
```

### 2. 仕様書生成（target: spec または all）
以下の形式で出力：

```markdown
## ページ構成

### セクション1: Hero
- 要素: タイトルテキスト（ID: hero-title）
- 要素: サブテキスト（ID: hero-subtitle）
- 要素: CTAボタン（ID: hero-cta）
- 要素: 背景画像（ID: hero-bg）

### セクション2: Features
...
```

### 3. Veloコード生成（target: velo または all）
- `src/pages/<pageName>.js` に実装
- 対応するテンプレートを `src/public/templates/` から参照
- 要素IDはStep 2で定義したものを使用

### 4. PRの作成
- ブランチ: `issue-<number>-wix-<pagename>`
- `node scripts/pr-up.js` で PR作成

## Notes
- Figmaへの書き込みは不可（読み取りのみ）
- HTMLコンポーネントへの埋め込みは編集不可のため使用しない
- ページレイアウトはデザイナーがEditor で実装する（Claudeは不可）
- Veloコードは要素IDが存在する前提で書く
