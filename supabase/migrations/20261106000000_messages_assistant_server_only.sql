-- YUKI の返事(role = 'assistant')はサーバー(service role)だけが書ける。
-- 利用者が自分で「YUKI の返事」を作り、YUKI の声で読ませることを防ぐ。
drop policy if exists messages_own on public.messages;

create policy messages_read_own on public.messages for select to authenticated
  using (user_id = (select auth.uid()));

-- 利用者が書けるのは、自分の会話への自分の発言だけ
create policy messages_insert_own_user on public.messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'user'
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );
-- 更新・削除のポリシーは作らない(利用者からは変更できない)

-- 書き換えられた可能性のある既存の返事は、念のため確認用に数だけ出す
-- select count(*) from public.messages where role = 'assistant';
