# SoT Contract

- 運用ルールの SoT は `agents/rules` とする。
- 実行コマンド定義の SoT は `agents/commands` とする。
- 実行物（スクリプト/資材）の SoT は `agents/skills` とする。
- 背景説明・補足文書の SoT は `docs/ai` とする。
- CI/CD 定義の SoT は `.github` とする。
- ローカル生成物の置き場は `tmp/` と `reports/` に固定する。
- `commands` は「目的/引数/参照/フロー」のみを保持する。
- 詳細な実装手順は `docs/ai/implementation-guides` へ分離する。
- 実行可能な成果物は `agents/skills` に置く。
- 同一内容を複数 SoT に重複記載しない。
- 迷った場合は SoT 側を正として参照先のみ更新する。
- escalation 契約は `agents/contracts/network-escalation.md` を参照する。
