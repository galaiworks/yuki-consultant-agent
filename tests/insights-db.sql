\set ON_ERROR_STOP on
-- 合成データで RLS・本人同意・再集計・再同意時の古いジョブ拒否を検証する。
create function public.assert_insight_test(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %', label; end if; end;
$$;
insert into auth.users select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 8) n;
insert into public.profiles (id, role) select id, case when right(id::text, 1) = '8' then 'admin' else 'client' end from auth.users;
select public.assert_insight_test((select bool_and(not insights_consent and insights_consent_at is null) from public.profiles), 'default-off');

-- 本人は同意だけを変更でき、日時・role・email を偽装できない。他人の同意を変えられない。
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
update public.profiles set insights_consent = true, insights_consent_at = '2000-01-01', role = 'admin', email = 'forged' where id = auth.uid();
select public.assert_insight_test((select insights_consent and insights_consent_at > '2026-01-01' and role = 'client' and email is null from public.profiles where id = auth.uid()), 'own-consent-protected-columns');
update public.profiles set insights_consent = true where id = '00000000-0000-4000-8000-000000000002';
reset role;
select public.assert_insight_test(not (select insights_consent from public.profiles where id = '00000000-0000-4000-8000-000000000002'), 'cannot-consent-for-other-user');
update public.profiles set insights_consent = true where id::text <= '00000000-0000-4000-8000-000000000006';
update public.profiles set display_name = '架空太郎', company_name = '架空商事', email = 'fake@example.com'
  where id = '00000000-0000-4000-8000-000000000001';
insert into public.conversations (id, user_id, updated_at) select id, id, clock_timestamp() - interval '1 minute' from public.profiles;
-- 同一利用者の複数会話を加えても人数は増えない。
insert into public.conversations (id, user_id, updated_at) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', clock_timestamp() - interval '1 minute');
insert into public.messages (conversation_id, user_id, role, text, created_at)
select id, user_id, 'user', '架空太郎と架空商事の相談 fake@example.com', updated_at - interval '1 second' from public.conversations;
insert into public.messages (conversation_id, user_id, role, text, created_at)
select id, user_id, 'assistant', '回答は抽出しない', updated_at - interval '1 second' from public.conversations;

-- 表も RPC も一般利用者・通常セッションの管理者には許可しない。
do $$ declare fn regprocedure; tbl text; r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach tbl in array array['insight_topics','insight_sources','insight_extractions'] loop
      perform public.assert_insight_test(not has_table_privilege(r, 'public.' || tbl, 'SELECT,INSERT,UPDATE,DELETE'), r || ':private-table:' || tbl);
    end loop;
    for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('claim_insight_conversations','read_insight_conversation','save_insight_extraction','release_insight_conversation','review_insight_topic') loop
      perform public.assert_insight_test(not has_function_privilege(r, fn, 'EXECUTE'), r || ':private-rpc:' || fn::text);
    end loop;
  end loop;
end $$;

set role service_role;
create temp table claims as select * from public.claim_insight_conversations(100);
select public.assert_insight_test((select count(*) = 7 from claims), 'only-consenting-users');
select public.assert_insight_test((select count(*) = 0 from public.claim_insight_conversations(10)), 'leases-prevent-duplicate-extraction');
select public.assert_insight_test((select count(*) = 1 from public.read_insight_conversation(
  '00000000-0000-4000-8000-000000000001', (select claim_token from claims where conversation_id = '00000000-0000-4000-8000-000000000001'))), 'only-user-message-input');
select public.assert_insight_test((select text not like '%架空太郎%' and text not like '%架空商事%' and text not like '%fake@example.com%'
  from public.read_insight_conversation('00000000-0000-4000-8000-000000000001', (select claim_token from claims where conversation_id = '00000000-0000-4000-8000-000000000001'))), 'profile-identifiers-redacted-before-ai');
select public.assert_insight_test(public.save_insight_extraction(conversation_id, claim_token, '合成テーマ', '一般化した悩みの型。', '集客', true), 'save-consenting-source') from claims where conversation_id = user_id and user_id::text <= '00000000-0000-4000-8000-000000000005';
select public.assert_insight_test((select user_count = 5 and status = 'draft' from public.insight_topics), 'four-to-five-needs-human-approval');
select public.assert_insight_test(public.save_insight_extraction(conversation_id, claim_token, '合成テーマ', '一般化した悩みの型。', '集客', true), 'save-additional-sources') from claims where conversation_id <> user_id or user_id::text > '00000000-0000-4000-8000-000000000005';
select public.assert_insight_test((select user_count = 6 and status = 'draft' from public.insight_topics), 'distinct-user-count-not-conversations');
select public.assert_insight_test((select count(*) = 0 from public.claim_insight_conversations(10)), 'unchanged-conversations-not-reprocessed');
select public.assert_insight_test(public.review_insight_topic((select id from public.insight_topics), 'approved', '00000000-0000-4000-8000-000000000008'), 'human-approval');
reset role;

-- 同じテーマの会話の更新だけでは人数を増やさず、既存の承認も解除しない。
update public.conversations set updated_at = clock_timestamp() where id = '00000000-0000-4000-8000-000000000001';
select public.assert_insight_test(public.save_insight_extraction(conversation_id, claim_token, '合成テーマ', '一般化した悩みの型。', '集客', true), 'reprocess-same-conversation') from public.claim_insight_conversations(10);
select public.assert_insight_test((select user_count = 6 and status = 'approved' from public.insight_topics), 'reprocess-keeps-count-and-human-review');

-- 非同意化で6->5、本人の通常セッションによる取り消しで5->4。後者で承認を取り消す。
update public.profiles set insights_consent = false where id = '00000000-0000-4000-8000-000000000006';
select public.assert_insight_test((select user_count = 5 and status = 'approved' from public.insight_topics), 'six-to-five-stays-approved');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
update public.profiles set insights_consent = false where id = auth.uid();
reset role;
select public.assert_insight_test((select user_count = 4 and status = 'draft' and reviewed_at is null from public.insight_topics), 'five-to-four-demotes-and-clears-review');
select public.assert_insight_test(not exists(select 1 from public.insight_sources where user_id = '00000000-0000-4000-8000-000000000001'), 'revocation-removes-all-user-sources');
select public.assert_insight_test(not exists(select 1 from public.insight_extractions where user_id = '00000000-0000-4000-8000-000000000001'), 'revocation-removes-progress');
select public.assert_insight_test(not public.review_insight_topic((select id from public.insight_topics), 'approved', '00000000-0000-4000-8000-000000000008'), 'cannot-approve-small-group');

-- 退会は auth.users の削除から起動しても再集計される。
delete from auth.users where id = '00000000-0000-4000-8000-000000000002';
select public.assert_insight_test((select user_count = 3 from public.insight_topics), 'account-deletion-recounts');

-- 抽出中の取り消し→再同意は古い結果を復活させない。
update public.conversations set updated_at = clock_timestamp() where user_id = '00000000-0000-4000-8000-000000000003';
create temp table old_claim as select * from public.claim_insight_conversations(10);
update public.profiles set insights_consent = false where id = '00000000-0000-4000-8000-000000000003';
update public.profiles set insights_consent = true where id = '00000000-0000-4000-8000-000000000003';
select public.assert_insight_test(not public.save_insight_extraction(conversation_id, claim_token, '古いテーマ', '古い型', 'その他', true), 'stale-result-rejected-after-reconsent') from old_claim;
select public.assert_insight_test((select count(*) = 0 from public.read_insight_conversation(conversation_id, claim_token)), 'stale-input-hidden') from old_claim;
select public.assert_insight_test((select user_count = 2 from public.insight_topics), 'revoked-contribution-not-restored');

-- 会話削除も人数を数え直し、最後の寄与が消えたテーマは残さない。
delete from public.conversations where user_id in ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005');
select public.assert_insight_test((select count(*) = 0 from public.insight_topics), 'empty-topic-deleted');
select 'insights DB assertions passed' as result;
