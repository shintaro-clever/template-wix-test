# 10-network

目的:
- ネットワーク利用時の運用境界を定義する。
- 通信失敗時の扱い方針の参照先を固定する。

必須ルール（VPS作業）:
- VPS作業は必ず最初に `bin/vps 'echo connected'` を実行し、接続成功を確認してから本作業へ進む。
- 接続確認に失敗した場合、SSHを連打しない。`fail2ban` による BAN を疑って停止する。
- 本作業コマンドは以下の順序で実行する:
  1. `bin/vps 'echo connected'`
  2. `bin/vps 'cd /srv/integration-hub && git checkout main && git pull --ff-only origin main && pm2 reload integration-hub-web'`

Workspace系修正時の反映後確認（必須）:
- 反映前確認:
  1. `bin/vps 'echo connected'`
  2. 接続失敗時は停止（SSH連打禁止、`fail2ban` BAN を疑う）
- 反映後の主要画面確認:
  1. `Project詳細 -> Workspace` の主導線で遷移できる
  2. Workspace左カラムで最近の会話一覧（`latest_summary` / `updated_at`）が見える
  3. 「新規会話開始」導線が見え、未選択状態にできる
  4. chat最小送信が通る（送信 -> 応答 -> 履歴更新が見える）
  5. 設定導線が機能する（`project-settings.html` / `settings-ai.html` へ遷移できる）
- 反映コマンドの標準形:
  `bin/vps 'echo connected' && bin/vps 'cd /srv/integration-hub && git checkout main && git pull --ff-only origin main && pm2 reload integration-hub-web'`

参照:
- `agents/contracts/network-escalation.md`
