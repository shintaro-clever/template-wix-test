# PR Gate 導入手順（.github-only / 観測モード）

## 目的
- 既存のCI/CD、Wix連携、ブランチ運用を壊さずに、PR運用（テンプレ遵守）を段階導入する。
- 変更は `.github/` のみ。既存コード・ビルド・デプロイ設定には触れない。
- まずは Phase 1（観測）：Gateは実行するが、落ちてもマージを止めない。

---

## 適用対象
- GitHubでPR運用している全リポジトリ（言語/フレームワーク不問）

---

## 導入ポリシー（固定）
### 1) 触るのは `.github/` だけ
- 追加・変更対象は `.github/` 配下に限定する
- 例外として `docs/` は説明用（運用手順）にのみ使用する（コードやCI影響なし）

### 2) Phase 1（観測）では強制しない
- Branch protection / ruleset の「必須チェック」に登録しない
- まずは “走る” 状態を作り、運用で定着させる

---

## 導入手順（Phase 1：観測）

### Step 0：衝突チェック（必須・30秒）
対象repoで以下のみ確認する。

#### (A) workflow ファイル衝突
- `/.github/workflows/pr-gate.yml` が既に存在するか
  - ある場合：このパッケージの `pr-gate.yml` をそのまま上書きしない
    - 対応①：既存を残し、追加側のファイル名を変える（例：`pr-gate-meta.yml`）
    - 対応②：既存の中身を確認し、同等なら導入不要（この作業はスキップ）

#### (B) PRテンプレ衝突
- `/.github/PULL_REQUEST_TEMPLATE.md` が既に存在するか
  - ある場合：全面置換は禁止（運用崩壊リスク）
  - 統合ルールに従い「追記のみ」で対応する（後述）

---

### Step 1：`.github/` のみを反映するPRを作る
- 変更は `.github/` のみ（既存コードに触れない）
- PRタイトル例：`chore: add PR Gate (observe mode)`

---

### Step 2：テストPRで動作確認
1. PR本文にテンプレが入ることを確認
2. Checks に PR Gate が表示されることを確認
3. Step Summary（またはログ）に不足項目が出ることを確認
   - Phase 1 は観測のため “失敗扱いにしない” のが正しい

---

### Step 3：マージ（観測開始）
- Phase 1 はマージを止めない
- 運用でテンプレ記入が定着するまでは強制しない

---

## PRテンプレ統合ルール（既存テンプレがある場合）
既存 `PULL_REQUEST_TEMPLATE.md` を残し、末尾に以下を追記する（置換禁止）。

追記ブロック（末尾に追加）：

## 関連 Issue
- Issue: #
- No Issue: はい / いいえ

## AC（Acceptance Criteria）
- [ ] 受け入れ条件1
- [ ] 受け入れ条件2

## 影響範囲 / リスク
- 影響範囲：
- ロールバック：

---

## トラブルシュート
### 1) Actionsが走らない
- org/repoで GitHub Actions が無効の可能性
- 権限制限の可能性
→ その場合でも既存環境を壊さない（影響ゼロ）。管理者に有効化を依頼。

### 2) workflow が二重に走る
- 既存CIと並列実行は正常
- ただし同名/同ファイル衝突は上書きになるので、必ず Step 0 を実施する

---

## 次フェーズ（参考）
### Phase 2（任意運用）
- レビュー運用でテンプレ未記入は差し戻しにする（仕組みではなく運用で強制）

-   +## Phase2-min docs evidence (Issue #21)
  +
  +- Date: YYYY-MM-DD
  +- PR: <PASTE_PR_URL_HERE>
  +- Actions Run: <PASTE_ACTIONS_RUN_URL_HERE>
  +- Notes: Phase2-min docs-only (T4/T5/T6) evidence; no .github changes

### Phase 3（強制）
- 必要になった時点で branch protection / ruleset / CODEOWNERS を検討
- いきなり全repo強制はしない（段階的に適用）


## Phase2（Integration Hub）運用差分

- Phase1の`.github/`限定方針は継続しつつ、`docs/ai/core/phase2-integration-hub.md` に沿って RBAC / Vault / GitHub Integration / Settings UI を連動させる。
- Gateで検出した不足事項は Issue #21 に戻して Decision を追記し、SoTを崩さない（Acceptance Criteria のチェックも同Issueで更新）。
- Vaultは Option A（未保存）をデフォルトに固定し、GitHubトークンは `docs/ai/core/vault-provider.md` のマスク運用で扱う。
- GitHub連携対象は `docs/ai/core/github-integration.md` のテーブルに登録済みであること（`tokenKeyRef` は Vaultキー参照のみ）。
- 設定作業や Gate override は必ず `audit_logs` の `github_integration` / `gate_override` 行として残す。
- Gateが緑になった run URL は Phase1同様にこのマニュアルへ追記し、レビュー時に参照できるよう固定する。

## Phase2-min docs evidence (Issue #21)

- Date: 2026-02-18
- PR: https://github.com/shintaro-clver/figma-ai-github-workflow/pull/23
- Actions Run: https://github.com/shintaro-clver/figma-ai-github-workflow/actions/runs/22142261886
- Notes: Phase2-min docs-only (T4/T5/T6) evidence; no .github changes

## Phase2 Gate 通過証跡

- PR: <PR URL（Phase2 enforcement 対応）>
- Actions Run: <Actions run URL>
- Date: YYYY-MM-DD
- Notes: Vault Option A / Issue #21 Decision 更新完了

## Phase1（solo）Gate 通過証跡

- PR: https://github.com/shintaro-clver/figma-ai-github-workflow/pull/20
- Actions Run: https://github.com/shintaro-clver/figma-ai-github-workflow/actions/runs/22140619772
- Date: YYYY-MM-DD
- Notes: No Issue 運用で実施（軽微な docs 更新）
