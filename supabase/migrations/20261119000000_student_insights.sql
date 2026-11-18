-- 相談の傾向は任意同意・匿名・運営承認つき。既存の回答用ナレッジとは分離する。
alter table public.profiles
  add column insights_consent boolean not null default false,
  add column insights_consent_at timestamptz;

create table public.insight_topics (
  id uuid primary key default gen_random_uuid(),
  theme text not null unique check (char_length(theme) between 1 and 100),
  pattern text not null check (char_length(pattern) between 1 and 300),
  category text not null check (category in ('集客', '商品', 'マインドセット', 'キャリア', 'お金', '人間関係', 'その他')),
  user_count integer not null default 0 check (user_count >= 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  video_gap boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  check (status <> 'approved' or (user_count >= 5 and reviewed_at is not null))
);

alter table public.conversations add constraint conversations_id_user_unique unique (id, user_id);
create table public.insight_sources (
  topic_id uuid not null references public.insight_topics (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (topic_id, user_id, conversation_id),
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade
);
create index insight_sources_user_idx on public.insight_sources (user_id);
create index insight_sources_conversation_idx on public.insight_sources (conversation_id);

-- 前回処理した会話の版と短いリースだけ。会話本文・AI の自由文は保存しない。
create table public.insight_extractions (
  conversation_id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  consent_at timestamptz not null,
  processed_updated_at timestamptz,
  claimed_updated_at timestamptz not null,
  claim_token uuid,
  claimed_until timestamptz,
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade
);

-- 管理者の通常セッションにもポリシーを与えない。service role のみ。
alter table public.insight_topics enable row level security;
alter table public.insight_sources enable row level security;
alter table public.insight_extractions enable row level security;
revoke all on public.insight_topics, public.insight_sources, public.insight_extractions from anon, authenticated;
grant all on public.insight_topics, public.insight_sources, public.insight_extractions to service_role;

-- 同意日時はクライアントの入力を信用せず、変更のたびに DB が付ける。
create function public.stamp_insights_consent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.insights_consent_at := case when new.insights_consent then clock_timestamp() else null end;
  elsif new.insights_consent is distinct from old.insights_consent then
    new.insights_consent_at := clock_timestamp();
  else
    new.insights_consent_at := old.insights_consent_at;
  end if;
  return new;
end;
$$;
create trigger profiles_insights_consent_stamp before insert or update on public.profiles
  for each row execute function public.stamp_insights_consent();

-- 同じ人の複数会話は人数に加算しない。5 人未満になったら承認も取り消す。
create function public.recount_insight_topic()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_topic uuid := case when tg_op = 'DELETE' then old.topic_id else new.topic_id end;
  v_count integer;
begin
  perform 1 from public.insight_topics where id = v_topic for update;
  select count(distinct user_id) into v_count from public.insight_sources where topic_id = v_topic;
  update public.insight_topics set
    user_count = v_count,
    status = case when v_count < 5 then 'draft' else status end,
    reviewed_by = case when v_count < 5 then null else reviewed_by end,
    reviewed_at = case when v_count < 5 then null else reviewed_at end,
    updated_at = clock_timestamp()
  where id = v_topic;
  if v_count = 0 then delete from public.insight_topics where id = v_topic; end if;
  return null;
end;
$$;
create trigger insight_sources_recount after insert or delete on public.insight_sources
  for each row execute function public.recount_insight_topic();

-- RLS 経由の直接更新でも、取り消しと削除・再集計を同一トランザクションにする。
-- 退会時は auth.users -> profiles の削除にも反応し、FK の削除順に依存しない。
create function public.cleanup_user_insights()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or not new.insights_consent then
    perform pg_catalog.pg_advisory_xact_lock(866201119);
    delete from public.insight_sources where user_id = old.id;
    delete from public.insight_extractions where user_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger profiles_cleanup_insights before delete or update of insights_consent on public.profiles
  for each row execute function public.cleanup_user_insights();

-- 1 起動は最大 10 会話。5 分で失効するリースで同じ会話の二重課金を抑える。
create function public.claim_insight_conversations(p_limit integer default 10)
returns table (conversation_id uuid, user_id uuid, consent_at timestamptz, claimed_updated_at timestamptz, claim_token uuid)
language sql security definer set search_path = '' as $$
  with candidates as (
    select c.id, c.user_id, c.updated_at, p.insights_consent_at
    from public.conversations c
    join public.profiles p on p.id = c.user_id
    left join public.insight_extractions e on e.conversation_id = c.id
    where p.insights_consent and p.insights_consent_at is not null
      and (e.processed_updated_at is null or c.updated_at > e.processed_updated_at)
      and (e.claimed_until is null or e.claimed_until < clock_timestamp())
    order by c.updated_at, c.id
    limit least(greatest(p_limit, 1), 10)
    for update of p, c skip locked
  )
  insert into public.insight_extractions as e
    (conversation_id, user_id, consent_at, claimed_updated_at, claim_token, claimed_until)
  select id, user_id, insights_consent_at, updated_at, gen_random_uuid(), clock_timestamp() + interval '5 minutes'
  from candidates
  on conflict (conversation_id) do update set
    consent_at = excluded.consent_at, claimed_updated_at = excluded.claimed_updated_at,
    claim_token = excluded.claim_token, claimed_until = excluded.claimed_until
  where e.claimed_until is null or e.claimed_until < clock_timestamp()
  returning conversation_id, user_id, consent_at, claimed_updated_at, claim_token;
$$;

-- AI に渡すのは同意中の本人の発言のみ。回答側の文章や会話タイトル・プロフィールは渡さない。
create function public.read_insight_conversation(p_conversation_id uuid, p_claim_token uuid)
returns table (text text)
language sql security definer set search_path = '' as $$
  select left(replace(replace(replace(m.text,
    coalesce(nullif(p.display_name, ''), chr(1)), '[人名]'),
    coalesce(nullif(p.company_name, ''), chr(1)), '[会社]'),
    coalesce(nullif(p.email, ''), chr(1)), '[メール]'), 2000) from public.messages m
  join public.insight_extractions e on e.conversation_id = m.conversation_id and e.user_id = m.user_id
  join public.profiles p on p.id = e.user_id
  where e.conversation_id = p_conversation_id and e.claim_token = p_claim_token
    and e.claimed_until > clock_timestamp()
    and p.insights_consent and p.insights_consent_at = e.consent_at
    and m.role = 'user' and m.created_at <= e.claimed_updated_at
  order by m.created_at desc, m.id desc limit 40;
$$;

-- 保存時にも同意の「版」とリースを確認。取り消し→再同意の間の古い結果も捨てる。
create function public.save_insight_extraction(
  p_conversation_id uuid, p_claim_token uuid, p_theme text, p_pattern text, p_category text, p_video_gap boolean
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_job public.insight_extractions%rowtype;
  v_topic uuid;
begin
  select p.* into v_profile from public.profiles p
    join public.conversations c on c.user_id = p.id where c.id = p_conversation_id for update of p, c;
  if not found or not v_profile.insights_consent then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(866201119);
  select * into v_job from public.insight_extractions where conversation_id = p_conversation_id for update;
  if not found or p_claim_token is null or v_job.claim_token is distinct from p_claim_token
    or v_job.claimed_until is null or v_job.claimed_until <= clock_timestamp()
    or v_job.consent_at is distinct from v_profile.insights_consent_at then return false; end if;

  if p_theme is not null then
    insert into public.insight_topics (theme, pattern, category, video_gap)
    values (p_theme, p_pattern, p_category, p_video_gap)
    on conflict (theme) do update set
      pattern = excluded.pattern, category = excluded.category, video_gap = excluded.video_gap,
      status = case when (insight_topics.pattern, insight_topics.category, insight_topics.video_gap)
        is distinct from (excluded.pattern, excluded.category, excluded.video_gap) then 'draft' else insight_topics.status end,
      reviewed_by = case when (insight_topics.pattern, insight_topics.category, insight_topics.video_gap)
        is distinct from (excluded.pattern, excluded.category, excluded.video_gap) then null else insight_topics.reviewed_by end,
      reviewed_at = case when (insight_topics.pattern, insight_topics.category, insight_topics.video_gap)
        is distinct from (excluded.pattern, excluded.category, excluded.video_gap) then null else insight_topics.reviewed_at end,
      updated_at = clock_timestamp()
    returning id into v_topic;
  end if;
  -- 会話のテーマが変わった場合だけ以前の寄与を外す。同じテーマの再実行で承認を失わせない。
  delete from public.insight_sources where conversation_id = p_conversation_id and topic_id is distinct from v_topic;
  if v_topic is not null then
    insert into public.insight_sources (topic_id, user_id, conversation_id)
      values (v_topic, v_job.user_id, p_conversation_id) on conflict do nothing;
  end if;
  update public.insight_extractions set processed_updated_at = v_job.claimed_updated_at,
    claim_token = null, claimed_until = null where conversation_id = p_conversation_id;
  return true;
end;
$$;

create function public.release_insight_conversation(p_conversation_id uuid, p_claim_token uuid)
returns void language sql security definer set search_path = '' as $$
  update public.insight_extractions set claim_token = null, claimed_until = null
  where conversation_id = p_conversation_id and claim_token = p_claim_token;
$$;

-- 人数の変更と承認を直列化し、取り消しと競合しても少人数の傾向を承認しない。
create function public.review_insight_topic(p_topic_id uuid, p_status text, p_reviewer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('approved', 'rejected') then raise exception 'invalid_status'; end if;
  perform pg_catalog.pg_advisory_xact_lock(866201119);
  update public.insight_topics set status = p_status, reviewed_by = p_reviewer_id,
    reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_topic_id and user_count >= 5;
  return found;
end;
$$;

revoke all on function public.stamp_insights_consent(), public.recount_insight_topic(), public.cleanup_user_insights(),
  public.claim_insight_conversations(integer), public.read_insight_conversation(uuid, uuid),
  public.save_insight_extraction(uuid, uuid, text, text, text, boolean), public.release_insight_conversation(uuid, uuid),
  public.review_insight_topic(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_insight_conversations(integer), public.read_insight_conversation(uuid, uuid),
  public.save_insight_extraction(uuid, uuid, text, text, text, boolean), public.release_insight_conversation(uuid, uuid),
  public.review_insight_topic(uuid, text, uuid) to service_role;
