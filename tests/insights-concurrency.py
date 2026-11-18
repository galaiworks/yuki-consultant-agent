"""一時 DB 専用の競合テスト。呼び出しごとに5秒の SQL 上限と10秒のプロセス上限を設ける。"""

import getpass
import selectors
import subprocess
import sys


def main() -> None:
    """取り消しと claim の両順序、および会話削除と保存の並行実行を検証する。"""
    socket_path = sys.argv[1]
    if not socket_path.startswith("/tmp/yuki-insights-pg."):
        raise ValueError("この検証スクリプトが作成した一時 DB 以外は接続できません")
    command = ["psql", "-X", "-qAt", "-h", socket_path, "-p", "55439", "-U", getpass.getuser(), "-d", "postgres", "-v", "ON_ERROR_STOP=1"]

    def sql(statement: str) -> str:
        """接続先を固定し、エラーならテストを停止する。"""
        return subprocess.run(command, input="set statement_timeout='5s';\n" + statement, text=True, capture_output=True, check=True, timeout=10).stdout

    def race(first: str, second: str) -> str:
        """先行トランザクションのロック取得を待ち、別接続から競合する操作を行う。"""
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            assert process.stdin is not None and process.stdout is not None
            process.stdin.write("set statement_timeout='5s'; begin;\n" + first + "\nselect 'ready'; select pg_sleep(0.5); commit;\n")
            process.stdin.close()
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ)
            try:
                if not selector.select(timeout=5) or process.stdout.readline().strip() != "ready":
                    raise AssertionError("先行トランザクションがロックを取得できませんでした")
            finally:
                selector.close()
            output = sql(second)
            process.wait(timeout=10)
            assert process.returncode == 0, process.stderr.read() if process.stderr else "SQL failed"
            return output
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)

    user = "00000000-0000-4000-8000-000000000009"
    sql(f"""
        insert into auth.users values ('{user}');
        insert into public.profiles (id, insights_consent) values ('{user}', true);
        insert into public.conversations (id, user_id) values ('{user}', '{user}');
    """)
    race(f"update public.profiles set insights_consent=false where id='{user}';",
         "select count(*) from public.claim_insight_conversations(10);")
    sql(f"select public.assert_insight_test(not exists(select 1 from public.insight_extractions where user_id='{user}'), 'revoke-before-claim-no-stale-ledger');")

    sql(f"update public.profiles set insights_consent=true where id='{user}';")
    race("do $$ begin perform public.claim_insight_conversations(10); end $$;",
         f"update public.profiles set insights_consent=false where id='{user}';")
    sql(f"select public.assert_insight_test(not exists(select 1 from public.insight_extractions where user_id='{user}'), 'claim-before-revoke-cleans-ledger');")

    sql(f"""
        update public.profiles set insights_consent=true where id='{user}';
        select public.save_insight_extraction(conversation_id, claim_token, '合成テーマ', '一般化した悩みの型。', 'その他', true)
          from public.claim_insight_conversations(10);
        update public.conversations set updated_at=clock_timestamp() where id='{user}';
    """)
    token = sql(f"select claim_token from public.claim_insight_conversations(10) where conversation_id='{user}';").strip()
    # 先行接続が会話をロック中、保存が topic を先にロックすると、削除の cascade と相互待ちになる。
    first = f"""
        do $$ begin perform 1 from public.conversations where id='{user}' for update; end $$;
    """
    # ready の後に先行接続が削除するよう、同じ専用接続内で遅延トリガーを設定する。
    sql("""create function public.delete_race_conversation() returns trigger language plpgsql as $$
      begin delete from public.conversations where id='00000000-0000-4000-8000-000000000009'; return new; end $$;
      create table public.race_finish (id integer);
      create constraint trigger race_finish_delete after insert on public.race_finish deferrable initially deferred
        for each row execute function public.delete_race_conversation();""")
    output = race(first + "insert into public.race_finish values (1);",
                  f"select public.save_insight_extraction('{user}', '{token}', '合成テーマ', '一般化した悩みの型。', 'その他', true);")
    assert output.strip() == "f", "削除された会話の抽出結果は保存できません"
    sql(f"select public.assert_insight_test(not exists(select 1 from public.insight_sources where user_id='{user}'), 'delete-versus-save-no-deadlock-or-source');")
    print("insights concurrency assertions passed (3 cases)")


if __name__ == "__main__":
    main()
