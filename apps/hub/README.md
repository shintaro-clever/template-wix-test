# Hub Jobs Console（Fallback）

1. `node server.js` を実行し、ブラウザで `http://localhost:3000/jobs` を開く。  
2. Job Builder で **Generate Offline Smoke Job** を押し、JSON を `job.offline_smoke.json` などのファイルに保存。  
3. ルートで `node scripts/run-job.js --job job.offline_smoke.json --role operator` を実行し、`.ai-runs/<run_id>/run.json`（必要なら `audit.jsonl`）を取得。  
4. `/jobs` の Run Result Intake に run.json / audit.jsonl を貼り付けて Parse → Gate / Triage が想定どおりか確認。  
5. Offline smoke が成功したら、Docs Update → Repo Patch の順に Job を生成・保存・実行し、同じ手順で Gate / Triage を記録する。
