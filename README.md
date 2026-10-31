# YUKI Consultant Agent

米国の現役ビジネスコンサル YUKI さんの知見をもとに、有料クライアントの経営相談に答える AI コンサルエージェントです。Next.js(Vercel)+ Supabase + Claude。

> 現在はテスト期間です。YUKI さんの資料は未登録で、ナレッジは動作確認用のサンプルだけです。

## できること
- クライアント限定ログイン(招待制、メールのリンクでログイン)
- AI 経営相談(ストリーミング表示、出典つき)
- 市場調査・戦略分析を専門エージェントが担当
- 診断レポート・90 日アクションプラン・事業計画書の作成(Guardian の 95 点チェック後に表示)
- 利用権の管理: 無料(テスト期間)/ 特別チケット / Stripe 決済 を切り替え可能
- 利用料の記録と、プランごとの月間上限

## セットアップ
1. Supabase プロジェクトを作り、DB 定義を反映する
   - おすすめ: Supabase の Project Settings → Integrations → GitHub でこのリポジトリをつなぎ、「Deploy to production」をオン。`main` に入った `supabase/migrations/` が自動で反映される
   - 手動の場合: `supabase/migrations/` のファイルを古い順に SQL Editor で実行
   - Authentication → Sign In / Providers で **「Allow new users to sign up」をオフ**(招待制にするため)
   - Authentication → URL Configuration に `https://<本番ドメイン>/auth/callback` を追加
2. `.env.example` を `.env.local` にコピーして値を入れる
3. 依存関係を入れて起動
   ```bash
   npm install
   npm run dev
   ```
4. Vercel にデプロイし、同じ環境変数を設定
   - 成果物の作成(`/api/jobs/run`)は最大 800 秒動くため **Vercel Pro 以上** を推奨
   - 10 分おきの Cron(`vercel.json`)も Pro 以上で動く

## 運用コマンド
```bash
# クライアントを招待(招待メールが届く)
npm run client:invite -- --email client@example.com --name "山田 太郎" --company "山田商事"
# 自分を管理者として招待
npm run client:invite -- --email you@example.com --admin

# 特別チケットを発行(コードはこの時だけ表示)
npm run pass:create -- --plan founding --days 30 --uses 1 --label "紹介枠"

# YUKI さんの字幕・資料を登録(本人提供のデータのみ)
npm run knowledge:ingest -- --file data/video01.srt --title "動画タイトル" --url "https://www.youtube.com/watch?v=..."
```

## 課金を始めるとき
1. Stripe で商品と Price を作り、`plans.stripe_price_id` に Price ID を入れる
2. `STRIPE_SECRET_KEY` と `STRIPE_WEBHOOK_SECRET` を設定
3. Stripe の Webhook 送信先に `https://<本番ドメイン>/api/billing/webhook` を登録
   (`customer.subscription.*` と `checkout.session.completed`)
4. `ACCESS_MODE=paid` に切り替える。チケット利用者はそのまま使い続けられる

## 開発
```bash
npm run typecheck
npm test
npm run build
```
Claude Code 向けのルールは `CLAUDE.md`、構成は `docs/architecture.md`。
