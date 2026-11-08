#!/usr/bin/env bash
# YUKI AI の公開前の設定を、ターミナルから順に進める。
# リポジトリのフォルダで実行する:  ./scripts/setup.sh <手順>
#
#   check            いまの状態を確認する(本番の状態チェック)
#   sql              Supabase に未実行の SQL を入れる(supabase/pending.sql)
#   vercel           Vercel に ElevenLabs と Voyage のキーを入れ、BOOTSTRAP_TOKEN を消して、本番を作り直す
#   import <ファイル> YUKI さんの取り込みファイルを本番 DB に入れる
#
# キーは画面に表示されない入力欄で聞き、ファイルにも履歴にも残さない。
set -euo pipefail

PROJECT_REF="fzicyvqfougotjgshufe"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
SITE_URL="https://yuki-consultant-agent.vercel.app"
VERCEL_PROJECT="yuki-consultant-agent"
VERCEL_SCOPE="galaiworks-3976s-projects"
cd "$(dirname "$0")/.."

ask_secret() { # $1 = 説明。入力は表示しない
  local v
  read -r -s -p "$1: " v
  echo >&2
  [ -n "$v" ] || { echo "入力が空でした。やり直してください" >&2; exit 1; }
  printf '%s' "$v"
}

cmd_check() {
  echo "▶ 本番の状態"
  curl -fsS "$SITE_URL/api/health" && echo
  echo
  echo "見かた: feedback_table=ok なら SQL は実行済み。missing なら ./scripts/setup.sh sql を実行してください"
}

cmd_sql() {
  echo "▶ Supabase に SQL を入れます(何度実行しても安全です)"
  echo "  アクセストークン(sbp_ で始まる)を https://supabase.com/dashboard/account/tokens で作って貼ってください"
  local token body res
  token="$(ask_secret 'Supabase アクセストークン')"
  body="$(node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync("supabase/pending.sql","utf8")}))')"
  res="$(curl -sS -w '\n%{http_code}' -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary "$body")"
  echo "${res%$'\n'*}"
  [ "${res##*$'\n'}" = "201" ] || [ "${res##*$'\n'}" = "200" ] || { echo "✗ 失敗しました(上のメッセージを Claude に送ってください)"; exit 1; }
  echo "${res}" | grep -q '"ok"' && echo "✓ SQL を実行しました" || echo "△ 実行はしましたが、結果が ok ではありません。上の表示を Claude に送ってください"
}

cmd_vercel() {
  echo "▶ Vercel の設定をします(初回はブラウザでログインを求められます)"
  npx --yes vercel@latest whoami >/dev/null 2>&1 || npx --yes vercel@latest login
  npx --yes vercel@latest link --yes --project "$VERCEL_PROJECT" --scope "$VERCEL_SCOPE" >/dev/null

  local key
  for name in ELEVENLABS_API_KEY VOYAGE_API_KEY; do
    case "$name" in
      ELEVENLABS_API_KEY) key="$(ask_secret 'ElevenLabs の API キー(sk_ で始まる)')" ;;
      VOYAGE_API_KEY) key="$(ask_secret 'Voyage AI の API キー(pa- で始まる)')" ;;
    esac
    npx --yes vercel@latest env rm "$name" production --yes --scope "$VERCEL_SCOPE" >/dev/null 2>&1 || true
    if ! printf '%s' "$key" | npx --yes vercel@latest env add "$name" production --sensitive --scope "$VERCEL_SCOPE" >/dev/null 2>&1; then
      printf '%s' "$key" | npx --yes vercel@latest env add "$name" production --scope "$VERCEL_SCOPE" >/dev/null
    fi
    echo "✓ $name を登録しました"
  done

  npx --yes vercel@latest env rm BOOTSTRAP_TOKEN production --yes --scope "$VERCEL_SCOPE" >/dev/null 2>&1 \
    && echo "✓ BOOTSTRAP_TOKEN を削除しました" || echo "・BOOTSTRAP_TOKEN はもうありません"

  echo "▶ 本番を作り直します(キーを反映するため。2〜3 分)"
  git pull --ff-only origin main
  npx --yes vercel@latest deploy --prod --yes --scope "$VERCEL_SCOPE" >/dev/null
  echo "✓ 本番に反映しました: $SITE_URL"
}

cmd_import() {
  local file="${1:-}"
  [ -f "$file" ] || { echo "取り込みファイルのパスを指定してください: ./scripts/setup.sh import ~/Downloads/yuki-knowledge-bundle.jsonl"; exit 1; }
  echo "▶ YUKI さんのデータを本番 DB に入れます(126 本・数分かかります)"
  echo "  service_role キーは https://supabase.com/dashboard/project/${PROJECT_REF}/settings/api-keys にあります"
  local service voyage
  service="$(ask_secret 'Supabase の service_role キー(secret)')"
  voyage="$(ask_secret 'Voyage AI の API キー(pa- で始まる)')"
  NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$service" VOYAGE_API_KEY="$voyage" \
    npx --yes tsx scripts/import-bundle.ts "$file"
}

case "${1:-}" in
  check) cmd_check ;;
  sql) cmd_sql ;;
  vercel) cmd_vercel ;;
  import) shift; cmd_import "${1:-}" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' ; exit 1 ;;
esac
