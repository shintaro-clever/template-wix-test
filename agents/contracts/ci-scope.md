# CI Scope Contract

- PRで実行するCIは構造チェックのみとする。
- PR向けworkflowは `paths` を限定して不要実行を防ぐ。
- PR向けworkflowは `concurrency` を必須とし、`cancel-in-progress: true` を設定する。
- devcontainer build は `workflow_dispatch` のみで実行する。
- PRで重い検証ジョブを追加しない。
- 将来CIを拡張する場合は別合意を前提とする。
