# YUKI Consultant Agent

米国の現役ビジネスコンサル YUKI さんの知見をもとに、有料クライアントの経営相談に答える AI コンサルエージェントです。Next.js(Vercel)+ Supabase + Claude。

> 現在はテスト期間です。YUKI さんの素材は管理画面から取り込みます(素材は社外秘なので、このリポジトリには入れません)。

## できること
- クライアント限定ログイン(管理者が登録した人だけ。パスワードまたはメールのリンク)
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
   - Vercel Pro 前提(処理時間の上限 800 秒、取りこぼし処理の Cron は 10 分おき)
   - Hobby で動かす場合は `maxDuration` を 300 に、Cron を 1 日 1 回にする

## 管理画面(/admin)
管理者でログインすると、ナビに「管理」が出ます。ここで次ができます。
- クライアントの登録(仮パスワードが表示されるので本人に伝える)と仮パスワードの再発行
- 特別チケットの発行と一覧
- 今月の API 費用(人ごと)、成果物の状態、95 点に届かず要確認になった成果物の確認と公開
- 回答への 👍/👎 とコメントの確認

管理者になるのは、`profiles.role = 'admin'` の人か、環境変数 `ADMIN_EMAILS`(カンマ区切り)に書いたメールアドレスの人です。

### 最初の管理者を作る
1. Vercel に `ADMIN_EMAILS`(自分のメール)と `BOOTSTRAP_TOKEN`(32 文字以上のランダム文字列)を入れて再デプロイ
2. `https://<本番ドメイン>/api/admin/bootstrap?token=<BOOTSTRAP_TOKEN>` を開くと、仮パスワードが表示される(管理者が 1 人でもいれば何もしない)
3. ログインして「アカウント」でパスワードを変更し、Vercel から `BOOTSTRAP_TOKEN` を消す

### 動作確認
`https://<本番ドメイン>/api/health` で、鍵の設定・DB・Claude への接続を確認できます(値そのものは表示しません)。

## 使うほど良くなる仕組み
- 回答ごとに 👍/👎 とコメントを付けられる。コメントは相談者メモに入り、その人への次回以降の回答に反映される
- 評価は `message_feedback` に残り、管理画面と `prompt-tuner` サブエージェントでの改善に使う
- 成果物は Guardian の採点(`evaluations`)が全件残る。点数の低い軸がスキル改善の候補になる

## 運用コマンド
```bash
# クライアントを登録(仮パスワードが表示されるので本人に伝える。メール送信は不要)
npm run client:invite -- --email client@example.com --name "山田 太郎" --company "山田商事"
# 招待メールで登録する場合(Supabase にメール送信サービスの設定が必要)
npm run client:invite -- --email client@example.com --send-email
# 自分を管理者として登録
npm run client:invite -- --email you@example.com --admin

# 特別チケットを発行(コードはこの時だけ表示)
npm run pass:create -- --plan founding --days 30 --uses 1 --label "紹介枠"

# 動画の逐語録と判断軸は、管理画面の「YUKI さんのデータを取り込む」から登録する
# 下は 1 本ずつ字幕ファイルを足すとき(本人提供のデータのみ)
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

## 公開前の設定(ターミナルから)

```bash
git clone https://github.com/galaiworks/yuki-consultant-agent.git && cd yuki-consultant-agent && npm ci
./scripts/setup.sh check                     # いまの状態
./scripts/setup.sh sql                       # Supabase に未実行の SQL を入れる(supabase/pending.sql)
./scripts/setup.sh vercel                    # ElevenLabs・Voyage のキーを入れ、BOOTSTRAP_TOKEN を消して本番を作り直す
./scripts/setup.sh import ~/Downloads/yuki-knowledge-bundle.jsonl   # YUKI さんのデータを入れる
```

キーは表示されない入力欄で聞き、ファイルにも履歴にも残しません。YUKI さんの取り込みファイルは社外秘なので、このリポジトリには入れません。
