#!/usr/bin/env bash
# 接続先はここで起動する一時 PostgreSQL だけ。本番の URL・.env は読み込まない。
set -euo pipefail
cd "$(dirname "$0")/.."
insights_pg_tmp=$(mktemp -d /tmp/yuki-insights-pg.XXXXXX)
cleanup() {
  pg_ctl -D "$insights_pg_tmp/data" -m immediate stop >/dev/null 2>&1 || true
  # 削除は行わず、テスト成果物の場所を返す。DB ログは曜日別の最大7本で循環する。
  printf 'ローカル DB の検証ファイル: %s\n' "$insights_pg_tmp"
}
trap cleanup EXIT
if ! initdb -D "$insights_pg_tmp/data" -A trust --no-locale -E UTF8 >"$insights_pg_tmp/init.log" 2>&1; then
  cat "$insights_pg_tmp/init.log"
  exit 1
fi
pg_ctl -D "$insights_pg_tmp/data" -l "$insights_pg_tmp/server.log" -o "-k $insights_pg_tmp -h '' -p 55439 -c logging_collector=on -c log_directory=log -c log_filename=server-%w.log -c log_rotation_age=1d -c log_rotation_size=0 -c log_truncate_on_rotation=on" -w start
psql -X -h "$insights_pg_tmp" -p 55439 -U "$(id -un)" -d postgres -v ON_ERROR_STOP=1 \
  -f tests/fixtures/insights-schema.sql \
  -f supabase/migrations/20261119000000_student_insights.sql \
  -f tests/insights-db.sql

# 複数接続の競合も、このプロセスが起動した一時 DB だけで確認する。
python3 tests/insights-concurrency.py "$insights_pg_tmp"
