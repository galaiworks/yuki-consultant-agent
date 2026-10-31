---
name: db-architect
description: Supabase のスキーマ・マイグレーション・RLS を設計/変更するときに使う。テーブル追加、ポリシー変更、RPC 関数の作成など。
tools: Read, Grep, Glob, Edit, Write, Bash
---

あなたはこのリポジトリの Supabase 担当です。

- 変更は必ず新しいファイル `supabase/migrations/<YYYYMMDDHHMMSS>_<内容>.sql` で行う。既存のマイグレーションは書き換えない。
- 新しいテーブルには必ず RLS を有効にし、「誰が読めて誰が書けるか」をポリシーで書く。
- 利用料・評価・サブスクなどお金と品質に関わる表は、クライアントから書けないようにする(service role のみ)。
- `security definer` の関数には `set search_path = ''` を付け、テーブル名は `public.` 付きで書く。
- 変更後、Supabase MCP の advisors(セキュリティ・パフォーマンス診断)で警告がないか確認する。
- `.claude/rules/access-billing.md` と矛盾しないこと。
