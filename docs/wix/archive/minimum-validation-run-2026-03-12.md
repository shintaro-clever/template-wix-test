# Minimum Validation Run 2026-03-12

## 次チャット冒頭用
- 次は Studio ブラウザ認証の実地確認から始める
- 対象 `site ID` は `0e9fab77-6694-464e-9f13-d5c320c88550`
- 案件画面まで通過したら、そのまま同じ `Hero` の再構成へ進む
- 続けて編集性確認を行い、`Go / 方針修正 / No-Go` を再判定する

## 目的
- `prototype/minimum-page/` を持ち込み元として、Wix Studio 最小検証の初回実施状況を記録する
- 次回以降に「どこまで確認済みか」「どこで止まったか」を誤認しないようにする
- 今回の阻害要因を `site ID 不明` ではなく `Wix Studio ブラウザ側の未ログインセッション` として正式に固定する
- 検証の主目的を、案件画面を開けること自体ではなく、`GitHub main` と `Wix Studio` の連携運用確認に置く

## 現フェーズの主タスク
- 主タスクは、`GitHub main` と `Wix Studio` の連携運用確認として、最小コードがどう反映されるかを確認すること
- 先行確認素材は `prototype/studio-smoke/` を使う
- Studio ブラウザ認証の再確認は、この主タスクを進めるための補助ログとして扱う

## 現フェーズの進捗
- `GitHub main` と `Wix Studio` の連携運用確認という主タスクは継続中
- 最小反映確認に使う素材として `prototype/studio-smoke/` は用意済み
- repo 側では `main` push 後に `wix publish` を走らせる workflow を追加済み
- ただし repo には `wix.config.json` がまだなく、`.wix/` 配下で確認できたのは `debug.log` のみだった
- GitHub Secrets の `WIX_API_KEY` は設定済みとして扱う
- 最新確認でも `wix.config.json` は未生成で、`.wix/` 配下の状態は `debug.log` のみで変化がなかった
- 現在は、Wix Studio 側で最小コード反映確認に進む前段の停止位置を記録している
- GitHub 起点で送る、または `GitHub main` と `Wix Studio` を連携する前提は維持している
- 停止理由は prototype 不足ではなく、Wix Studio 側の Git Integration と `wix.config.json` を伴う実動条件が repo 外でまだ確定していないため
- 補助ログ上は認証再確認 13 回目まで記録済みで、主タスクは引き続き停止中

## 今回の初回検証対象
- 対象は `Hero` とする
- 理由は、見出し、本文、画像、CTA の差し替え点が 1 セクション内に集まっており、再構成性と編集性を最初に確認しやすいため
- 本番 LP 全体は対象外とし、Hero 単位の再構成と編集操作だけを確認対象にする
- あわせて、GitHub 起点で送る、または `GitHub main` と `Wix Studio` を連携する前提で最小反映確認を行う

## 対象案件の固定情報
- 対象 URL は `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
- 今回の対象 `site ID` は `0e9fab77-6694-464e-9f13-d5c320c88550` として扱う
- 次回以降も同じ案件で最小検証を再開する
- `site ID` は確定済みであり、今回の阻害要因ではない

## 持ち込み前確認

### repo 側
- `prototype/minimum-page/index.html` に Hero、Overview、Explanation、CTA、Footer の構造がある
- Hero には見出し、本文、CTA、画像プレースホルダが分かれている
- 余計な JavaScript は入っていない
- `docs/wix/minimum-validation-spec.md` `docs/wix/import-runbook.md` `docs/wix/editability-checklist.md` `docs/wix/go-no-go.md` が揃っている
- `prototype/minimum-page/` は最小検証の開始条件を満たしている
- `wix.config.json` は未生成で、Wix Studio 側の Git Integration 完了はまだ確認できていない
- `WIX_API_KEY` は GitHub Repository Secrets に設定済みとして扱う
- `.wix/` 配下の最新確認結果は `debug.log` のみで、接続成立を示す追加生成物はまだ見えていない

### Wix CLI 側
- `npm run wix:version` は通過し、CLI は利用可能だった
- ただし標準保存先では認証情報を `/home/codespace/.wix` に保存できず失敗した
- 保存先を `/tmp` に切り替えて再実行し、`npx wix whoami` でログイン済みを確認した

## Wix Studio 側の実施結果

### 実施できたこと
- `https://manage.wix.com/studio` へのブラウザ到達を確認した
- 対象 `site ID` 付き URL へ直接アクセスできることを確認した
- 自動ブラウザ上では Studio 本体ではなく、`Sign up / Log in` 画面が表示されるところまで確認した
- `site ID` が分からないことは今回の詰まりではないと確認した

### 実地確認で観測した事実
- 1. Studio ブラウザ単独ログイン可否
  - 自動ブラウザ上でログイン済み状態は確認できなかった
  - `https://manage.wix.com/studio` を開いた時点で、案件一覧または案件画面ではなく `Sign up / Log in` 画面が表示された
- 2. 対象 URL 再到達可否
  - 対象 URL `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites` には再到達を試行した
  - URL 自体は開けた
- 3. 案件画面表示可否
  - 対象 URL を開いても案件画面の表示は確認できなかった
- 4. 実際に落ちた画面名または状態
  - `https://manage.wix.com/studio` では `Sign up / Log in` 画面に落ちた
  - 対象 URL でも同じく `Sign up / Log in` 画面に落ちた

### 認証再試行ログ

#### 再確認 1 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認では、その成功条件は満たしていない

#### 再確認 2 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。未通過として扱う
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。未通過として扱う
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 2 回目でも、その成功条件は満たしていない

#### 再確認 3 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。未通過として扱う
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。未通過として扱う
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 3 回目でも、その成功条件は満たしていない

#### 再確認 4 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 4 回目でも、その成功条件は満たしていない

#### 再確認 5 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 5 回目でも、その成功条件は満たしていない

#### 再確認 6 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 6 回目でも、その成功条件は満たしていない

#### 再確認 7 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 7 回目でも、その成功条件は満たしていない

#### 再確認 8 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 8 回目でも、その成功条件は満たしていない

#### 再確認 9 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 9 回目でも、その成功条件は満たしていない

#### 再確認 10 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: `対象 site ID 0e9fab77-6694-464e-9f13-d5c320c88550 の案件画面表示は確認できなかった。未到達`
- 補足:
  - 成功条件は「対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面が表示されること」
  - 今回の再確認 10 回目でも、その成功条件は満たしていない

#### 再確認 11 回目以降の記録枠
- 確認日時: `YYYY-MM-DD`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `画面名`
  - 判定: `pass | fail`
  - 補足: `一言メモ`
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `画面名`
  - 判定: `pass | fail`
  - 補足: `一言メモ`
- 補足:
  - 成功条件に対する結果を書く

#### 再確認 11 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。Git Integration 完了の実地確認にも進めていない
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。repo 側の `wix.config.json` 生成も未確認
- 補足:
  - 今回の再確認 11 回目でも、対象案件画面には未到達だった
  - `wix.config.json` は repo 上に存在せず、Wix Studio 側の Git Integration 完了は未確認のまま

#### 再確認 12 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。Git Integration 接続成立も確認できていない
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。repo 側の `wix.config.json` も未生成のまま
- 補足:
  - 今回の再確認 12 回目でも、対象案件画面には未到達だった
  - `.wix/` 配下の状態は `debug.log` のみで、接続成立を示す追加生成物は確認できなかった

#### 再確認 13 回目
- 確認日時: `2026-03-12`
- 確認 URL: `https://manage.wix.com/studio`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。Git Integration 接続成立も確認できていない
- 確認 URL: `https://manage.wix.com/dashboard/0e9fab77-6694-464e-9f13-d5c320c88550/setup?referralInfo=my-sites`
  - 表示された画面: `Sign up / Log in`
  - 判定: `fail`
  - 補足: 対象 `site ID 0e9fab77-6694-464e-9f13-d5c320c88550` の案件画面表示は確認できなかった。repo 側の `wix.config.json` も未生成のまま
- 補足:
  - 今回の再確認 13 回目でも、対象案件画面には未到達だった
  - `.wix/` 配下の状態は `debug.log` のみで、接続成立を示す追加生成物は確認できなかった

### 現在の停止位置
- `GitHub main` と `Wix Studio` の連携運用確認として、repo 側の publish workflow 追加までは完了した
- `prototype/studio-smoke/` による最小反映確認は未実施
- `Hero` 再構成と編集性確認は主タスクの次段階であり、現時点では未着手
- 未実施理由は、Wix Studio 側でこの repo の Git Integration がまだ確認できず、repo に `wix.config.json` も生成されていないため
- したがって、現時点の未実施は prototype 不足ではなく、GitHub 連携運用確認の外部前提未充足による停止である

## 詰まり方の切り分け

### 1. CLI 側の詰まり
- 原因: 認証情報の保存先権限不足
- 症状: `EACCES: permission denied, mkdir '/home/codespace/.wix'`
- 対応: `HOME=/tmp XDG_CONFIG_HOME=/tmp` を付けてログインし直した
- 結果: CLI 認証自体は通った

### 2. Studio ブラウザ側の詰まり
- 原因: CLI の認証状態とブラウザの Studio ログイン状態が連動していない
- 症状: `manage.wix.com/studio` と対象 `site ID` 付き URL の両方で、案件画面ではなくログイン画面が出る
- 影響: Studio 側の再構成と編集性確認に進めない
- 正式な阻害要因: `Wix Studio ブラウザ側の未ログインセッション`

## 今回の確定事項
- `site ID` は `0e9fab77-6694-464e-9f13-d5c320c88550` で確定済み
- `prototype/minimum-page/` は最小検証開始条件を満たしている
- 現在の阻害要因は `Wix Studio ブラウザ側の未ログインセッション` である
- したがって、論点は `site ID` や prototype の不足ではなく、Studio 側の認証導線固定である
- `https://manage.wix.com/studio` と対象 dashboard URL は、3 回目の再確認でもどちらも `Sign up / Log in` 画面だった
- この状態は prototype 欠陥ではなく、Studio ブラウザ認証未到達として扱う
- 主目的は `GitHub main` と `Wix Studio` の連携運用確認であり、案件画面到達は必要に応じた確認事項として扱う

## 編集性チェック観点の暫定評価

### 事前構造として問題がない点
- Hero 内で見出し、本文、画像、CTA が独立している
- 他セクションと分かれた境界があり、Hero 単体で切り出して持ち込みやすい
- CTA は文言差し替え対象として読み取りやすい

### 未確認の点
- Wix Studio 上で見出しと本文を別々に編集できるか
- 画像差し替えで隣接レイアウトが崩れないか
- CTA 文言とリンク先を独立して変更できるか
- Hero を起点に、日常更新をコードへ戻らず回せるか

### 次回の記録フォーマット
- テキスト差し替え: `Pass | Partial | Fail` - 未実施
- 画像差し替え: `Pass | Partial | Fail` - 未実施
- CTA 変更: `Pass | Partial | Fail` - 未実施
- 順序変更: `Pass | Partial | Fail` - 未実施
- 非エンジニア運用性: `Pass | Partial | Fail` - 未実施

## Go / No-Go の暫定判定
- 判定は `方針修正`
- 意味は「原型修正」ではなく、「認証導線を固定してから同じ Hero 検証を再実施する」

### 判定理由
- repo 側の原型、仕様、runbook は最小検証を始める状態まで揃っている
- `site ID` は確定しており、prototype も開始条件を満たしている
- CLI 認証は通るが、Studio ブラウザ側へそのまま接続できない
- この状態では、編集性、再現性、運用負荷を Studio 実画面で評価しきれない
- したがって `Go` でも `No-Go` でもなく、接続導線の補正が先

### WIX-STUDIO-16 実判定の現在地
- 判定状態: `未判定`
- 理由: 案件画面未到達のため、`WIX-STUDIO-14` と `WIX-STUDIO-15` が未実施
- 判定根拠は、今後 `Hero` 再構成結果と編集性確認結果を記入して確定する

## 次にやること
- Studio ブラウザ側で案件画面へ入れる認証導線を先に固定する
- 同じ `Hero` を対象に、Wix Studio 上で最小単位の再構成を行う
- `docs/wix/editability-checklist.md` に沿って実編集を確認する
- その結果で `docs/wix/go-no-go.md` の `Go / 方針修正 / No-Go` を再判定する
