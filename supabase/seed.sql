-- プラン(料金は未定。Stripe の price ID は課金開始時に設定)
insert into public.plans (id, name, monthly_usage_limit_usd, stripe_price_id) values
  ('founding', 'Founding Client(テスト期間)', 30.00, null),
  ('standard', 'Standard', 50.00, null),
  ('premium', 'Premium', 150.00, null)
on conflict (id) do nothing;

-- テスト用サンプル知識。YUKI さんの発言ではありません。
-- 本番データを入れる前に `delete from public.knowledge_sources where is_test;` で消します。
with src as (
  insert into public.knowledge_sources (kind, title, url, is_test)
  values ('test_sample', '【テスト用サンプル】米国市場に出る前の確認事項(YUKIさんの発言ではありません)', null, true)
  returning id
)
insert into public.knowledge_chunks (source_id, chunk_index, content, start_sec)
select src.id, v.idx, v.content, v.start_sec
from src, (values
  (0, '米国市場に出る前に、まず日本で売れている理由を一文で言えるようにします。理由が言えない商品は、米国でも説明できません。', 0),
  (1, '米国の顧客は、価格より先に「誰の何の問題を解くのか」を聞いてきます。ターゲットを州や業界まで絞ると、最初の 10 社が見つけやすくなります。', 45),
  (2, '最初の 90 日は、売上より学びを優先します。週に 5 件の顧客インタビューを続け、断られた理由を表にまとめます。', 120)
) as v(idx, content, start_sec);
