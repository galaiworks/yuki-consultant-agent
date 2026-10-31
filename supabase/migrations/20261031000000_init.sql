-- YUKI Consultant Agent 初期スキーマ
-- 方針:
--   * すべてのテーブルに RLS。クライアントは自分の行だけ読める
--   * 利用料・評価ログ・サブスク状態はサーバー(service role)だけが書く
--   * 利用権 = 有効なサブスク(Stripe / 特別チケット / 管理者付与)

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------
-- プラン
-- ---------------------------------------------------------------
create table public.plans (
  id text primary key,
  name text not null,
  -- galaiworks が API 費用を持つため、1 人あたりの月間上限(USD)を必ず持つ
  monthly_usage_limit_usd numeric(10, 2) not null check (monthly_usage_limit_usd >= 0),
  stripe_price_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- プロフィール(auth.users と 1:1)
-- ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  company_name text,
  industry text,
  annual_revenue_band text,
  us_expansion_status text,
  role text not null default 'client' check (role in ('client', 'admin')),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- クライアントがプロフィールを更新しても role / stripe_customer_id は変えられないようにする
create function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    new.role := old.role;
    new.stripe_customer_id := old.stripe_customer_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------
-- 特別チケット(アクセスパス)
-- コードそのものは保存せず SHA-256 ハッシュだけを持つ
-- ---------------------------------------------------------------
create table public.access_passes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text,
  plan_id text not null references public.plans (id),
  duration_days integer not null default 30 check (duration_days > 0),
  max_redemptions integer not null default 1 check (max_redemptions > 0),
  redemption_count integer not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.access_pass_redemptions (
  pass_id uuid not null references public.access_passes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (pass_id, user_id)
);

-- ---------------------------------------------------------------
-- サブスク(利用権)。Stripe でもチケットでも同じ表に入る
-- ---------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id text not null references public.plans (id),
  source text not null check (source in ('stripe', 'access_pass', 'admin')),
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  current_period_end timestamptz,
  stripe_subscription_id text unique,
  access_pass_id uuid references public.access_passes (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_idx on public.subscriptions (user_id);

-- チケットを使う。成功すると利用期限を返す
create function public.redeem_access_pass(p_code_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_pass public.access_passes%rowtype;
  v_sub public.subscriptions%rowtype;
  v_end timestamptz;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_pass from public.access_passes
  where code_hash = p_code_hash
  for update;

  if not found then
    raise exception 'pass_not_found';
  end if;
  if v_pass.revoked_at is not null then
    raise exception 'pass_revoked';
  end if;
  if v_pass.expires_at is not null and v_pass.expires_at <= now() then
    raise exception 'pass_expired';
  end if;
  if exists (
    select 1 from public.access_pass_redemptions
    where pass_id = v_pass.id and user_id = v_user
  ) then
    raise exception 'pass_already_redeemed';
  end if;
  if v_pass.redemption_count >= v_pass.max_redemptions then
    raise exception 'pass_used_up';
  end if;

  insert into public.access_pass_redemptions (pass_id, user_id) values (v_pass.id, v_user);
  update public.access_passes set redemption_count = redemption_count + 1 where id = v_pass.id;

  -- 同じプランのチケット利用権が残っていれば延長、なければ新規
  select * into v_sub from public.subscriptions
  where user_id = v_user and plan_id = v_pass.plan_id and source = 'access_pass'
    and status = 'active'
  order by current_period_end desc nulls last
  limit 1
  for update;

  if found then
    v_end := greatest(coalesce(v_sub.current_period_end, now()), now())
             + make_interval(days => v_pass.duration_days);
    update public.subscriptions
      set current_period_end = v_end, access_pass_id = v_pass.id, updated_at = now()
      where id = v_sub.id;
  else
    v_end := now() + make_interval(days => v_pass.duration_days);
    insert into public.subscriptions (user_id, plan_id, source, status, current_period_end, access_pass_id)
    values (v_user, v_pass.plan_id, 'access_pass', 'active', v_end, v_pass.id);
  end if;

  return v_end;
end;
$$;

revoke all on function public.redeem_access_pass(text) from public, anon;
grant execute on function public.redeem_access_pass(text) to authenticated;

-- ---------------------------------------------------------------
-- 相談
-- ---------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_idx on public.conversations (user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  -- 出典(動画 URL・秒数)など
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- 相談をまたいで覚えておく事実
create table public.client_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  fact text not null,
  created_at timestamptz not null default now()
);

create index client_memories_user_idx on public.client_memories (user_id, created_at desc);

-- ---------------------------------------------------------------
-- ナレッジ(YUKI さんの動画字幕・資料)
-- ---------------------------------------------------------------
create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('youtube', 'document', 'test_sample')),
  title text not null,
  url text,
  published_at date,
  -- テスト用サンプルは YUKI さんの発言ではない。本番データ投入時に削除する
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  start_sec integer,
  end_sec integer,
  embedding extensions.vector(1024),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index knowledge_chunks_trgm_idx on public.knowledge_chunks
  using gin (content extensions.gin_trgm_ops);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ハイブリッド検索(文字列一致 + ベクトル)を RRF で統合
create function public.search_knowledge(
  query_text text,
  query_embedding extensions.vector(1024) default null,
  match_count integer default 6
)
returns table (
  chunk_id uuid,
  source_id uuid,
  title text,
  url text,
  kind text,
  is_test boolean,
  content text,
  start_sec integer,
  score double precision
)
language sql
stable
set search_path = ''
as $$
  with keyword as (
    select c.id,
           row_number() over (
             order by extensions.word_similarity(query_text, c.content) desc
           ) as rank
    from public.knowledge_chunks c
    where c.content ilike '%' || query_text || '%'
       or extensions.word_similarity(query_text, c.content) > 0.15
    order by extensions.word_similarity(query_text, c.content) desc
    limit match_count * 4
  ),
  semantic as (
    select c.id,
           row_number() over (
             order by c.embedding operator(extensions.<=>) query_embedding
           ) as rank
    from public.knowledge_chunks c
    where query_embedding is not null and c.embedding is not null
    order by c.embedding operator(extensions.<=>) query_embedding
    limit match_count * 4
  ),
  fused as (
    select coalesce(k.id, s.id) as id,
           coalesce(1.0 / (60 + k.rank), 0) + coalesce(1.0 / (60 + s.rank), 0) as score
    from keyword k
    full outer join semantic s on s.id = k.id
  )
  select c.id, src.id, src.title, src.url, src.kind, src.is_test, c.content, c.start_sec, f.score
  from fused f
  join public.knowledge_chunks c on c.id = f.id
  join public.knowledge_sources src on src.id = c.source_id
  order by f.score desc
  limit match_count;
$$;

-- ---------------------------------------------------------------
-- 成果物(Lane B)と Guardian 評価
-- ---------------------------------------------------------------
create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  kind text not null check (kind in ('diagnosis_report', 'action_plan', 'business_plan', 'other')),
  brief text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'needs_review', 'approved', 'escalated', 'failed')),
  content_md text,
  final_score integer,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deliverables_user_idx on public.deliverables (user_id, created_at desc);
create index deliverables_queue_idx on public.deliverables (status, created_at) where status = 'queued';

-- キューから 1 件取り出す(複数ワーカーでも二重処理しない)
create function public.claim_next_deliverable()
returns setof public.deliverables
language sql
security definer
set search_path = ''
as $$
  update public.deliverables d
     set status = 'running', updated_at = now()
   where d.id = (
     select id from public.deliverables
      where status = 'queued'
      order by created_at
      limit 1
      for update skip locked
   )
  returning d.*;
$$;

revoke all on function public.claim_next_deliverable() from public, anon, authenticated;

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables (id) on delete cascade,
  attempt integer not null,
  total_score integer not null,
  axis_scores jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  verdict text not null,
  self_reflection jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 利用料ログ(API 費用は galaiworks 負担のため必ず記録)
-- ---------------------------------------------------------------
create table public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  deliverable_id uuid references public.deliverables (id) on delete set null,
  agent text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  web_search_requests integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index usage_logs_user_month_idx on public.usage_logs (user_id, created_at);

create function public.my_usage_this_month()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
  from public.usage_logs
  where user_id = auth.uid()
    and created_at >= date_trunc('month', now());
$$;

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.access_passes enable row level security;
alter table public.access_pass_redemptions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.client_memories enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.deliverables enable row level security;
alter table public.evaluations enable row level security;
alter table public.usage_logs enable row level security;

create policy plans_read on public.plans for select to authenticated using (true);

create policy profiles_read_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- access_passes は管理者のみ(コード利用は redeem_access_pass 経由)
create policy access_passes_admin on public.access_passes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy access_pass_redemptions_read_own on public.access_pass_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy subscriptions_read_own on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy conversations_own on public.conversations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy messages_own on public.messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy client_memories_own on public.client_memories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy knowledge_sources_read on public.knowledge_sources for select to authenticated using (true);
create policy knowledge_chunks_read on public.knowledge_chunks for select to authenticated using (true);

create policy deliverables_read_own on public.deliverables for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy deliverables_insert_own on public.deliverables for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'queued');

create policy evaluations_admin_read on public.evaluations for select to authenticated
  using ((select public.is_admin()));

create policy usage_logs_read_own on public.usage_logs for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
