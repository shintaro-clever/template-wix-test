# UI Pages Map (SoT)

このファイルは UI ページ導線の一次情報です。新規ページ追加・URL変更時は必ず更新します。

## UI-M1 Done

- 対象ページ（Runs/Jobs/Connections/Members/Invites/Audit + Settings-Language）は静的M1として実装済み。
- `build:ui + selftest` を含む `volta run npm test` に合格していることを完了条件とする。

## Rules

- サイドバーに追加するリンクは `href="/ui/<name>.html"` を使う。
- 追加時は必ず `apps/hub/static/ui/<name>.html` を作成する。
- PR前に `npm test`（= `build:ui` 含む）を実行し、include未展開混入を防ぐ。

## i18n Key Naming（固定）

- 新規キー（ページ）：`ui.<page>.(title|h1|desc|primary|empty.*|table.*|section.*|action.*)`
- ナビ：`nav.*` はサイドバー専用
- 共通：`common.*`（例：save/cancel/back/retry/notImplemented など）
- 互換性：既存の camelCase / legacy キーは削除せず互換維持で残す（移行は後続で段階的に行う）

## build:ui 運用（固定）

- UIは共通パーツを `apps/hub/static/ui/partials/` に分離し、SSIは使わない
- 配信前に `npm run build:ui` を実行し、各 `apps/hub/static/ui/*.html` に partials をインライン展開して配信用HTMLへ上書きする
- VPS運用では `git pull` 後に `npm run build:ui` を必ず実行してから `pm2 reload` する
- `hub.test-plan.help` の `location ^~ /api/` は `proxy_pass http://127.0.0.1:3000;` に固定し、UIとAPIのupstreamを一致させる
- `pm2 reload` 直後は一時的に 502 が出る可能性があるため、`curl https://hub.test-plan.help/api/runs` を必ず1回実行して 200 を確認する
- 上書きにより差分が大きくなることは当面許容する
- 将来的な改善案として、UI-M2/OPSで source/build 出力分離（生成物とソースの分離）を検討する（現時点では未着手）

## Page Table

| Page Name | URL | File | Nav Key (`sidebar.js`) | Note |
|---|---|---|---|---|
| ダッシュボード | `/ui/dashboard.html` | `apps/hub/static/ui/dashboard.html` | `dashboard` | `data-page` 省略時も URL 推定で active |
| プロジェクト一覧 | `/ui/projects.html` | `apps/hub/static/ui/projects.html` | `projects` | サイドバー直リンク |
| プロジェクトホーム | `/ui/project.html` | `apps/hub/static/ui/project.html` | `projects` | `project*` は `projects` に正規化 |
| プロジェクトスレッド | `/ui/project-thread.html` | `apps/hub/static/ui/project-thread.html` | `projects` | 同上 |
| プロジェクト接続 | `/ui/project-connections.html` | `apps/hub/static/ui/project-connections.html` | `projects` | 同上 |
| プロジェクトDrive | `/ui/project-drive.html` | `apps/hub/static/ui/project-drive.html` | `projects` | 同上 |
| 実行一覧 | `/ui/runs.html` | `apps/hub/static/ui/runs.html` | `projects` | `runs/run/jobs/job/connections/connection` は `projects` に正規化 |
| 実行詳細 | `/ui/run.html` | `apps/hub/static/ui/run.html` | `projects` | 同上 |
| ジョブ一覧 | `/ui/jobs.html` | `apps/hub/static/ui/jobs.html` | `projects` | 同上 |
| ジョブ詳細 | `/ui/job.html` | `apps/hub/static/ui/job.html` | `projects` | 同上 |
| 接続一覧 | `/ui/connections.html` | `apps/hub/static/ui/connections.html` | `projects` | 同上 |
| 接続詳細 | `/ui/connection.html` | `apps/hub/static/ui/connection.html` | `projects` | 同上 |
| プロジェクトメンバー | `/ui/project-members.html` | `apps/hub/static/ui/project-members.html` | `projects` | `project-*` 正規化対象 |
| プロジェクト招待 | `/ui/project-invites.html` | `apps/hub/static/ui/project-invites.html` | `projects` | 同上 |
| プロジェクト監査ログ | `/ui/project-audit.html` | `apps/hub/static/ui/project-audit.html` | `projects` | 同上 |
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
