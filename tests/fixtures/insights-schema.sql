-- ローカルの空 DB 専用。今回の機能が依存する既存 Supabase スキーマの最小構成。
-- 外部 DB の URL や認証情報は使用しない。
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql as $$ select current_user::text $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client', email text, display_name text, company_name text, stripe_customer_id text, updated_at timestamptz default now()
);
create function public.is_admin() returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;
\ir ../../supabase/migrations/20261104000100_protect_profile_email.sql
create trigger profiles_protect_columns before update on public.profiles for each row execute function public.protect_profile_columns();
alter table public.profiles enable row level security;
create policy profiles_read_own on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
create table public.conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, role text not null, text text not null,
  created_at timestamptz not null default clock_timestamp()
);
