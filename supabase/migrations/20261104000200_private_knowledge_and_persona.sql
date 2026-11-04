-- YUKI さんの素材(社外秘)をクライアントから直接読めないようにし、判断軸(5 つの層)を DB に置く。
-- リポジトリは公開なので、本人の素材はコードに入れず DB だけに保存する。

-- 1) ナレッジはサーバー(service role)だけが読む。
--    チャットの検索もサーバー側で service role を使う(src/app/api/chat/route.ts)。
drop policy if exists knowledge_sources_read on public.knowledge_sources;
drop policy if exists knowledge_chunks_read on public.knowledge_chunks;
revoke all on function public.search_knowledge(text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.search_knowledge(text, extensions.vector, integer) to service_role;

-- 2) 判断軸(価値観・結論の出し方・手法・断定しない領域・トンマナ・要約)
create table if not exists public.persona_layers (
  key text primary key check (key in ('summary', 'values', 'reasoning', 'methods', 'boundaries', 'voice')),
  body text not null,
  version text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
-- ポリシーは作らない = クライアントからは読み書きできない。service role だけが使う
alter table public.persona_layers enable row level security;
