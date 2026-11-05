# CLAUDE.md - YUKI Consultant Agent

Claude Code がこのリポジトリで作業するときの最上位ルールです。

## プロダクト
米国の現役ビジネスコンサル YUKI さん(YouTube `@yukipedia`)の知見をもとに、**有料クライアント限定**で経営相談に答える AI コンサルエージェント。

- 現在は**テスト期間**。YUKI さんの素材(公開動画 126 本の逐語録と、そこから作った判断軸 5 層)は受け取り済み。管理画面の「YUKI さんのデータを取り込む」で DB に入れる
- **このリポジトリは公開**。YUKI さんの素材(逐語録・判断軸・引用・評価ケース)は社外秘なので、絶対にコミットしない。DB(`persona_layers`・`knowledge_*`、service role のみ)にだけ置く
- API キーは当面 galaiworks が持つ。だから**利用料の記録と月間上限は必須**
- 課金は後から開始。今は `ACCESS_MODE=open`(招待済みなら無料)。特別チケットでの利用も可能

構成の全体像は `docs/architecture.md`。

## 絶対に守ること
1. **AI であることを隠さない**。YUKI として一人称・会話調で話してよい(本人公認の AI)が、画面に AI 表示を常に出し、聞かれたら AI だと答える。本人が言っていない考え・体験は作らない
2. **YUKI さんのデータは本人の合意と提供があるものだけ**。無断スクレイピング禁止
3. **成果物は Guardian の 95 点ループを通す**(`.claude/rules/quality-95.md`)
4. **秘密情報はサーバー側だけ**。`SUPABASE_SERVICE_ROLE_KEY`・`ANTHROPIC_API_KEY`・`STRIPE_*` をクライアントコードで使わない
5. **全テーブルに RLS**。お金・品質に関わる表はクライアントから書けないようにする

## エージェント構成(本番)
| エージェント | モデル | 実装 |
|---|---|---|
| Lead Consultant(司令塔) | `MODELS.lead` | `src/lib/agents/lead.ts` |
| YUKI Brain(ナレッジ検索) | なし(DB 検索) | `src/lib/knowledge/search.ts` |
| Market Researcher | `MODELS.worker` | `src/lib/agents/researcher.ts` |
| Strategy Analyst | `MODELS.worker` | `src/lib/agents/analyst.ts` |
| Deliverable Writer | `MODELS.worker` | `src/lib/agents/writer.ts` |
| Guardian(品質保証) | `MODELS.guardian` | `src/lib/agents/guardian.ts` |

モデル ID は `src/lib/config.ts` の `MODELS` だけで管理する。

## YUKI さんの判断軸(本番)
- 判断軸は `persona_layers` 表の 7 つ(summary / values / reasoning / methods / boundaries / voice / profile)。profile は経歴・転機・人間関係・性格・習慣の人格プロファイル。読み込みは `src/lib/persona.ts`
- 使い方のルール(優先順位、確定/仮説、条件→結論→理由)は `PERSONA_RULES`(公開してよい運用ルールだけを書く)
- 判断軸を直すときは、元のパイプライン(yukipedia_youtube)で直して取り込みファイルを作り直し、管理画面から入れ直す

## スキル(開発と本番で共用)
- `consult-flow`: 相談の進め方
- `yuki-voice` / `yuki-frameworks`: **仮版**。`persona_layers` が空のときだけ使う予備

## 運用と改善
- 運用は管理画面(`/admin`)で行う。管理画面のデータは `requireAdmin()` を通した service role でだけ読み書きする
- 回答の評価(`message_feedback`)と Guardian の採点(`evaluations`)が改善の材料。プロンプトやスキルを直すときは、まずこの 2 つを見る

## 開発の決まり
- TypeScript strict。Claude の呼び出しは `@anthropic-ai/sdk` 経由のみ
- DB 変更は新しいマイグレーションファイルで(既存は書き換えない)
- 変更後は `npm run typecheck` と `npm test`。マージ前に `npm run build`
- コミットは `feat: / fix: / refactor: / docs: / test: / chore:` で始める

## 開発用サブエージェント(`.claude/agents/`)
- `db-architect`: スキーマ・RLS
- `agent-engineer`: 本番エージェントの実装
- `prompt-tuner`: 評価セットでの品質改善
- `reviewer`: PR 前のセキュリティ・課金・表示ルールの確認

## ルール集(`.claude/rules/`)
- `quality-95.md`: 95 点ループと採点軸
- `advice-boundaries.md`: AI 表示、専門家に回す領域、データの扱い
- `access-billing.md`: 利用権・チケット・Stripe
