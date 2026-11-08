-- 本番に未適用のマイグレーションをまとめたもの(何度実行しても安全)。scripts/setup.sh の sql、または SQL Editor で実行する
-- 中身は supabase/migrations/20261104000000 〜 20261106000000 と同じ

-- ① 回答への評価(👍/👎)
create table if not exists public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);
create index if not exists message_feedback_created_idx on public.message_feedback (created_at desc);
alter table public.message_feedback enable row level security;
drop policy if exists message_feedback_own on public.message_feedback;
create policy message_feedback_own on public.message_feedback for all to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()));

-- ② 利用者が自分のメールアドレスや権限を書き換えられないようにする
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    new.role := old.role;
    new.stripe_customer_id := old.stripe_customer_id;
    new.email := old.email;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ③ YUKI さんの素材を利用者から直接読めないようにし、判断軸の表を作る
drop policy if exists knowledge_sources_read on public.knowledge_sources;
drop policy if exists knowledge_chunks_read on public.knowledge_chunks;
revoke all on function public.search_knowledge(text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.search_knowledge(text, extensions.vector, integer) to service_role;
create table if not exists public.persona_layers (
  key text primary key,
  body text not null,
  version text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.persona_layers enable row level security;

-- ④ 判断軸の 7 層目(人格プロファイル)を入れられるようにする
alter table public.persona_layers drop constraint if exists persona_layers_key_check;
alter table public.persona_layers add constraint persona_layers_key_check
  check (key in ('summary', 'values', 'reasoning', 'methods', 'boundaries', 'voice', 'profile'));

-- ⑤ YUKI の返事はサーバーだけが書ける(利用者は自分の発言だけ)
drop policy if exists messages_own on public.messages;
drop policy if exists messages_read_own on public.messages;
drop policy if exists messages_insert_own_user on public.messages;
create policy messages_read_own on public.messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy messages_insert_own_user on public.messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'user'
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

-- ⑥ 確認用: 下の 1 行が「ok」と表示されれば完了です
select case
  when to_regclass('public.message_feedback') is not null
   and to_regclass('public.persona_layers') is not null
   and exists (select 1 from pg_policies where tablename = 'messages' and policyname = 'messages_insert_own_user')
  then 'ok' else 'まだ足りないものがあります' end as result;
