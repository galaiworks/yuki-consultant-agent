# アーキテクチャ

構成案(図つき): https://claude.ai/artifact/W1VMCuxLSggv7jtwBELCs2

## 全体
```
相談者(Next.js / Vercel)
  └─ POST /api/chat ── 利用権チェック(decideAccess)
        └─ Lead Consultant(Tool Runner + ストリーミング)
              ├─ search_yuki_knowledge → Supabase search_knowledge(文字列 + ベクトル)
              ├─ research_market       → Market Researcher(Web 検索)
              ├─ analyze_strategy      → Strategy Analyst
              ├─ save_client_memory    → client_memories
              └─ request_deliverable   → deliverables(queued)
                                            └─ after() / Vercel Cron → Writer ⇄ Guardian(95 点ループ)
```

## 2 つのレーン
- **Lane A(チャット)**: 数秒〜1 分。司令塔が専門エージェントを道具として呼ぶ
- **Lane B(成果物)**: 数分。`deliverables` に積み、応答後に処理。取りこぼしは `/api/jobs/run`(Vercel Cron)が拾う

## 利用権
`subscriptions` に入っている有効な行(Stripe / 特別チケット / 管理者付与)で判定。`ACCESS_MODE=open` の間は招待済みなら既定プランで利用可。どの場合もプランの月間上限(USD)を超えると止まる。

## キャッシュ
司令塔の system は「固定部分(人格・スキル)」と「相談者情報」の 2 ブロック。固定部分に 1 時間キャッシュを付けている。固定部分に日付や相談者情報を入れるとキャッシュが効かなくなる。

## 今後の差し替え予定
- YUKI さんの字幕・資料を受け取ったら `npm run knowledge:ingest` で登録し、テスト用サンプルを削除
- `yuki-voice` / `yuki-frameworks` を本人の言葉で書き直す
- 成果物レーンを Claude Managed Agents(outcome 付きセッション)へ移す検討
