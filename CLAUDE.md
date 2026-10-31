# CLAUDE.md - YUKI Consultant Agent

Claude Code がこのリポジトリで作業するときの最上位ルールです。

## プロダクト
米国の現役ビジネスコンサル YUKI さん(YouTube `@yukipedia`)の知見をもとに、**有料クライアント限定**で経営相談に答える AI コンサルエージェント。

- 現在は**テスト期間**。YUKI さんの字幕・資料はまだ受け取っていない(ナレッジは「テスト用サンプル」のみ)
- API キーは当面 galaiworks が持つ。だから**利用料の記録と月間上限は必須**
- 課金は後から開始。今は `ACCESS_MODE=open`(招待済みなら無料)。特別チケットでの利用も可能

構成の全体像は `docs/architecture.md`。

## 絶対に守ること
1. **AI であることを隠さない**。YUKI さん本人として振る舞わない。本人が言っていないことを本人の発言にしない
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

## スキル(開発と本番で共用)
`.claude/skills/*/SKILL.md` は本番エージェントが実行時に読み込む。話し方・フレームワークの変更はここだけで行う。
- `yuki-voice`: 話し方(**仮版**。本人データで置き換える)
- `yuki-frameworks`: 思考の型(**仮版**。一般的な型を仮置き)
- `consult-flow`: 相談の進め方

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
