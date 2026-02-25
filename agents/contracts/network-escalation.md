# Network Escalation Contract

- `escalated` は正規承認経路での実行を指す。
- `escalated` は bypass や danger モードを意味しない。
- 通常 `git push` が sandbox 制限で失敗した場合のみ escalated を検討する。
- Network Gate が OK であることを確認してから escalated を使う。
- 通常経路で成功する場合は escalated を使わない。
- `--dangerously-bypass-approvals-and-sandbox` は永久禁止。
- `--sandbox=danger-full-access` は永久禁止。
- 失敗時は失敗コマンドをそのまま記録する。
- 失敗時は stderr 末尾をそのまま記録する。
- 記録には実行モード（通常/escalated）を必ず含める。
