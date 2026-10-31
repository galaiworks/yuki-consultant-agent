# 利用権と課金

## 今の運用(テスト期間)
- 利用者は有料クライアント限定。Supabase Auth の招待制(自分で新規登録はできない)。
- `ACCESS_MODE=open`: 招待済みなら既定プラン(`founding`)で無料利用。
- API 費用は galaiworks 負担。プランごとの月間上限(USD)を超えたら止まる。

## 課金開始後
- `ACCESS_MODE=paid` にすると、有効なサブスクが必要になる。サブスクの入り方は 3 つで、どれも `subscriptions` 表に入る。
  1. Stripe のオンライン決済(`source = stripe`)
  2. 特別チケット(`source = access_pass`)… 招待特典・無償提供など
  3. 管理者付与(`source = admin`)
- Stripe を使うには `STRIPE_SECRET_KEY` と `STRIPE_WEBHOOK_SECRET` を設定し、`plans.stripe_price_id` に Price ID を入れる。

## 守ること
- サブスク・利用料・評価ログはサーバー(service role)だけが書く。クライアントからは書けない。
- チケットコードは保存しない(SHA-256 ハッシュのみ)。
