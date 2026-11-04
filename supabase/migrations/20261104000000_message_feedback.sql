-- 回答への評価(👍/👎 とコメント)
-- 使うほど良くなるための材料。管理画面と、プロンプト改善(prompt-tuner)で使う。
create table public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index message_feedback_created_idx on public.message_feedback (created_at desc);

alter table public.message_feedback enable row level security;

create policy message_feedback_own on public.message_feedback for all to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()));
