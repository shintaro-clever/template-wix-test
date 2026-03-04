# UI Pages Map (SoT)

このファイルは UI ページ導線の一次情報です。新規ページ追加・URL変更時は必ず更新します。

## Rules

- サイドバーに追加するリンクは `href="/ui/<name>.html"` を使う。
- 追加時は必ず `apps/hub/static/ui/<name>.html` を作成する。
- PR前に `npm test`（= `build:ui` 含む）を実行し、include未展開混入を防ぐ。

## Page Table

| Page Name | URL | File | Nav Key (`sidebar.js`) | Note |
|---|---|---|---|---|
| ダッシュボード | `/ui/dashboard.html` | `apps/hub/static/ui/dashboard.html` | `dashboard` | `data-page` 省略時も URL 推定で active |
| プロジェクト一覧 | `/ui/projects.html` | `apps/hub/static/ui/projects.html` | `projects` | サイドバー直リンク |
| プロジェクトホーム | `/ui/project.html` | `apps/hub/static/ui/project.html` | `projects` | `project*` は `projects` に正規化 |
| プロジェクトスレッド | `/ui/project-thread.html` | `apps/hub/static/ui/project-thread.html` | `projects` | 同上 |
| プロジェクト接続 | `/ui/project-connections.html` | `apps/hub/static/ui/project-connections.html` | `projects` | 同上 |
| プロジェクトDrive | `/ui/project-drive.html` | `apps/hub/static/ui/project-drive.html` | `projects` | 同上 |
| アナリティクス | `/ui/analytics.html` | `apps/hub/static/ui/analytics.html` | `analytics` | サイドバー直リンク |
| 設定トップ | `/ui/settings.html` | `apps/hub/static/ui/settings.html` | `settings` | サイドバー直リンク |
| 設定: 外観 | `/ui/settings-appearance.html` | `apps/hub/static/ui/settings-appearance.html` | `settings` | `settings*` は `settings` に正規化 |
| 設定: 接続管理 | `/ui/settings-connections.html` | `apps/hub/static/ui/settings-connections.html` | `settings` | 同上 |
| 設定: Drive出力先 | `/ui/settings-drive.html` | `apps/hub/static/ui/settings-drive.html` | `settings` | 同上 |
| 設定: 言語 | `/ui/settings-language.html` | `apps/hub/static/ui/settings-language.html` | `settings` | 同上 |

## Sidebar Link Check (NAV-10)

サイドバーの `href="/ui/*.html"` は、上記ファイルが存在すること。

確認コマンド:

```bash
grep -oE 'href="[^"]+"' apps/hub/static/ui/partials/sidebar.html | sort -u
ls -1 apps/hub/static/ui/*.html | sed 's#.*/##' | sort
```
