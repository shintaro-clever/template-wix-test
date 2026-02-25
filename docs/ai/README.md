# AI運用ガイド（責務境界）

本リポジトリのAI運用における SoT は `agents/` 配下です。
詳細は `agents/README.md` を参照してください。

## 置き場の原則

- `agents/`: AI運用ルール・Runbook・再利用スキル
- `.github/`: CI/CD・PRテンプレート・GitHub運用
- `docs/`: プロダクト仕様・設計方針・運用ドキュメント
- `src/`: アプリケーション実装コード
- `tests/`: テストコード（selftest含む）

## Notes (EN)

- AI operation source of truth lives under `agents/`.
- CI config belongs to `.github/`, product specs to `docs/`, and runtime code to `src/`.
