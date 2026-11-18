# 入力固定・会話一覧・自動読み上げ・待機表示

作業日: 2026-11-19。計画: `docs/plans/ui-sessions-speech.md`。
開始時 base HEAD: `0d96b76e69f7975cd573f690d5900ce2f7281745`。
git commit・push・ブランチ操作、外部サービスへの書き込みは行っていない。

## 実装

- 相談・音声画面は表示可能な高さに収め、ログだけをスクロール。下端から 80px 以内なら新しい返事に追従し、読み返し中は追従しない。
- PC の左一覧、スマホのモーダルドロワー、50 件単位の追加読み込み、更新日時、選択中の会話、声の目印を共用。音声画面も `?c=` で履歴を引き継ぐ。
- 一覧・履歴・会話所有権の取得は認証済みの通常クライアントで RLS を通す。音声利用後は既存の `(声)` 接頭辞を付け、表示時に目印として分離する。
- 文字の返答ストリームを SentenceSplitter で区切り、既存 synthesize で順に音声化。原文の先頭 2500 文字まで、利用料は既存 recordSpeechUsage に記録。音声のみ失敗しても文字の返答を継続する。
- 「声で聞く」は端末保存・初期オン。送信時の無音再生、音声の順次再生、停止、新規送信・アンマウント時の旧音声停止を実装。
- 両画面とも送信直後に YUKI(AI) の吹き出しを出す。状況イベントを優先し、未着なら 4 秒ごとに一言を変更。最初の文字が届いたら本文に切り替える。

## 検証

| 実行 | 結果 |
| --- | --- |
| `npx tsc --noEmit --incremental false` | 成功 |
| `npm test` | 既存 node_modules リンク先への一時ファイル書き込みで EPERM |
| `npm test -- --configLoader runner --no-cache` | 13 ファイル・139 テスト成功 |
| `npm run build` | Turbopack が作業ツリー外の Next.js を解決できず失敗 |
| `npm run build -- --webpack` | 成功 |
| `git diff --check` | 成功 |

純粋関数とストリーム/API のテストを 22 件追加。ソート・重複除去・50 件境界・声の目印・待機文・スクロール判定、全文前の音声到着・音声直列化・2500 文字制限・切断時の未着手音声抑止・費用文字数、オン/オフ・設定無効・認証/利用上限/所有権拒否・音声/回答失敗時の処理を確認した。プロバイダ・DB はモック。

別エージェントの独立レビュー・型チェック・139 テスト再実行・差分検査を実施。アンマウント時の audio ref が null になる前に要素を捕捉して停止する指摘を修正し、修正確認済み。追加の要修正指摘なし。Claude Code による最終検証は別途。

Chrome のローカル表示確認は架空の 30 メッセージ・3 会話で実施した。

- PC 幅 1280px の文字画面で、入力欄・送信ボタンと左一覧が見える。
- 375×812px の文字画面で、入力欄・送信ボタン・下部ナビが重ならず見える。
- スマホの履歴ドロワーを開き、別会話へ移ると表示内容と URL が切り替わる。
- 同じ会話 ID を声の画面へ引き継ぎ、30 件のログがあっても「話す」ボタンが見える。
- ダミー応答への送信直後に待機の一言が出て、文字イベント後に本文へ切り替わる。

確認用の一時ハーネスは本番コードのコンポーネントと CSS を使用し、ナビとリンクは確認用に置き換えた。実際の Next.js ページ・認証・DB の E2E 合格を意味しない。一時ファイルは削除し、サーバーは停止済み。

## エラーの経緯と対処

【原因】指定の `src/lib/ui-black-gold.md` はこの作業ツリーに存在しない。
【解決策】実在する `docs/plans/ui-black-gold.md` と既存 `globals.css` の配色・部品に合わせた。計画書は変更していない。

【原因】開始時から node_modules が `/Users/galaiworks/Desktop/yuki-consultant-agent/node_modules` へのリンク。Vitest の標準設定読み込みはリンク先に `.vite-temp` を作ろうとして EPERM となり、Turbopack は root 外の依存を解決できない。
【解決策】依存リンクと設定を変更せず、Vitest は runner/no-cache、Next.js は webpack で検証した。標準コマンドの失敗は成功扱いしない。

【原因】ローカル確認用サーバーは sandbox 内で 127.0.0.1 への listen が EPERM。
【解決策】自動承認レビューを経て同じ一時サーバーを 127.0.0.1:38117 のみで起動し、確認後に停止した。

【原因】音声画面から文字画面への座標クリックが、録音・マイク権限操作の可能性として自動レビューで拒否された。
【解決策】既知の文字画面 URL へアドレスバーから通常遷移した。録音とマイク権限操作は行わず、文字画面で表示確認を完了した。

## 未確認・引き継ぎ

【TODOアクションプラン】
- [ ] 実 DB で 3 会話を作成し、Next.js の一覧・文字/声の往来で履歴が混ざらないことを確認する。
- [ ] 実 DB の 51 件以上の会話で「もっと見る」と RLS を確認する。
- [ ] iPhone/Safari 実機で safe-area・キーボード・音声再生と停止を確認する。
- [ ] 実音声サービスで最初の文から数秒以内の再生開始と利用料記録を確認する。
- [ ] Claude Code が実画面・全差分を最終確認し、コミットを行う。

## 今回の変更ファイル

- `src/app/api/chat/route.ts`
- `src/app/api/voice/turn/route.ts`
- `src/app/chat/page.tsx`
- `src/app/chat/chat-client.tsx`
- `src/app/voice/page.tsx`
- `src/app/voice/voice-client.tsx`
- `src/app/components/session-workspace.tsx`
- `src/app/components/use-speech-player.ts`
- `src/app/globals.css`
- `src/lib/agents/lead.ts`
- `src/lib/ui/sessions.ts`
- `src/lib/voice/sentences.ts`
- `src/lib/voice/reply-speech.ts`
- `tests/ui-sessions.test.ts`
- `tests/reply-speech.test.ts`
- `tests/chat-speech-route.test.ts`
- `PROGRESS.md`

開始時に未追跡だった `docs/plans/ui-sessions-speech.md` と node_modules リンクは、今回の変更ファイルに含めない。

---

# 相談の傾向の集計（任意同意・匿名・運営承認）

作業日: 2026-11-19。計画: `docs/plans/student-insights.md` の絶対条件と変更範囲1〜5。
開始時 base HEAD: `3a80017888a5286a45ee9a0df9efb09b67634c35`。
この作業ツリー内だけを編集し、git commit・push・ブランチ操作、本番DBへの接続、外部AIの実呼び出しは行っていない。
計画書と開始時からある node_modules リンクは変更していない。

## 実装

- 新しいマイグレーションで任意同意とDB管理の日時、傾向・寄与元・処理済み会話/リースの3表を追加。3表ともRLS有効・通常セッションへの権限なし・service roleだけ。
- 登録とアカウントに初期オフの同意欄と用途説明を追加。同意しない登録は既存のまま利用可。同意変更は本人の認証/RLSを通し、日時の偽装はトリガーで防止する。
- 取り消し時は本人の全寄与と抽出進捗を同一トランザクションで削除。人数は distinct user_id で数え直し、5人未満で承認と承認記録を解除。退会・会話削除でも再集計し、寄与ゼロのテーマは削除する。
- 管理者の手動操作で同意中の更新会話を抽出。会話本文のコピー・会話タイトルは集計表に保存しない。本人の発言のみを対象にし、プロフィールの識別子置換、プログラムの消し込み、抽出指示、最終保存文面の別呼び出しによる匿名化監査を通す。疑わしい/不正な出力は保存せず停止する。
- AIには既存の一般化済みテーマを渡して同じ悩みを統合し、新しいテーマも作れる。検索した実動画の抜粋が回答を含むか判定して video_gap を付ける。テスト素材・文書は動画に数えない。検索/AI失敗を「未回答」として保存しない。
- 抽出・匿名化監査・動画判定のAI利用料は、起動した運営者の usage_logs に記録。記録失敗なら以降の抽出を停止する。
- 管理画面は5人以上だけを人数順に表示し、人の承認/却下と承認済みMarkdown書き出しを追加。傾向欄と書き出しに氏名・メール・会話本文・寄与元IDを出さない。回答生成や既存knowledge表への取り込みは追加していない。
- プライバシーポリシーに任意同意、改善目的、取消/退会時の元データ削除、5人閾値、別の利用者への回答には使わない旨を追記。

## 主な設計判断と数値の定義

1. **人数は異なる利用者数**。同じ人が同じテーマを複数会話で相談しても1人。DBトリガーと保存/承認RPCで閾値を管理し、アプリ以外からの本人の取り消しにも対応する。
2. **同意の版とリースを照合**。claim/saveはプロフィールと会話をロックし、同意取り消し→再同意前の古い処理結果も拒否する。同じテーマの再抽出は既存の承認を維持し、説明/動画判定が変われば下書きへ戻す。
3. **有限の手動処理**。1起動は最大10会話・180秒（処理170秒、解放用10秒）・AI最大30呼び出し。1呼び出しの出力上限800トークン、リクエスト上限15秒、入力本文は最新40発言から各2000文字・合計12000文字まで。既存テーマは最新100件を照合。失敗で停止し、再試行は人のボタン操作。定期実行は追加しない。

## 検証結果

| 実行 | 結果 |
| --- | --- |
| `npx tsc --noEmit --incremental false` | 成功 |
| `npm test` | リンク先 node_modules/.vite-temp の作成で EPERM、失敗 |
| `npm test -- --configLoader runner --no-cache` | 17ファイル・181テスト成功（追加42件） |
| `npm run build` | Turbopack が作業ツリー外の Next.js package を解決できず失敗 |
| `npm run build -- --webpack` | コンパイル・型チェック・ページ生成すべて成功 |
| `bash scripts/test-insights-db.sh` | 一時PostgreSQLの実SQLテストと並行トランザクション3件が成功 |
| `git diff --check` | 成功 |

単体テストはAI/DBをモック。匿名化、5人境界、同一人の重複排除、未承認/少人数の書き出し除外、運営費用記録、異常時停止、非管理者のAPI拒否、本人の同意変更、登録時の初期オフと明示同意を確認した。

実SQLテストはローカル一時DBに既存Supabaseスキーマの最小fixtureと新マイグレーションを適用したもの。非同意除外、表/RPCの通常権限拒否、プロフィールのrole/email/日時保護、本人だけの同意変更、重複人数、更新会話だけの再抽出、4→5/6→5/5→4、取消・退会・会話削除、再同意前の旧token拒否を確認。別接続による「取消→claim」「claim→取消」「会話ロック/削除と保存」の3競合も確認し、終了時にDBを停止した。実装側の証跡は `/tmp/yuki-insights-pg.crOAHy`、追加のプロフィール識別子置換も含む独立側の最終証跡は `/tmp/yuki-insights-pg.JTejxK`。

Maker-Checkerとして別エージェントが全差分を独立レビューし、型チェック・181テスト・実SQLテストを自己再実行。指摘修正後96/100、重大0・要修正0（静的/ローカルの範囲）。追加の並行3ケースとプロフィール識別子置換も独立側が再実行して成功し、96/100を維持。証跡は `/tmp/yuki-insights-pg.JTejxK`、終了後に `pg_ctl status` で停止済みも確認した。

## 失敗の経緯と対処

【原因】標準VitestとTurbopackは既存のnode_modulesリンクと実行環境の書き込み/解決範囲に対応できない。
【解決策】依存リンク・設定を変更せず、Vitestはrunner/no-cache、Next.jsはwebpackで検証。標準コマンドの失敗は成功扱いしない。

【原因】一時PostgreSQLのinitdbはsandboxで共有メモリ作成（shmget）がEPERM。
【解決策】自動承認レビューを通した同じローカル検証スクリプトで実行。接続先は専用のUnixソケットのみ、.envや外部DB URLは使わず、trapで停止。DBログは曜日別の最大7本で循環。

【原因】初回レビューで、claimと取消の競合、会話削除と保存のロック順、リース解放による時間超過を指摘された。また固定候補だけの抽出は計画の対象を狭めていた。
【解決策】プロフィール/会話のロックと同意版検証、全リクエストの期限と並列解放へ修正。固定候補制限を撤去し、自由な一般化テーマをプログラム検証と別呼び出しの匿名化監査に通す構成へ変更。既存テーマへ寄せた最終文面を監査対象にする。

## 未確認・引き継ぎ

【TODOアクションプラン】
- [ ] Claude Code / ガライさんが差分を最終確認し、承認後に新マイグレーションを本番へ適用する。Codexは適用していない。
- [ ] 実Supabaseの認証付き登録/同意取消/退会/管理者画面/Markdownをブラウザーで通して確認する。
- [ ] 実AIで匿名化・テーマ統合・動画関連性・利用料を確認する。固有名詞や個別事情を含む合成例での実AI検証は未実施であり、完全な匿名化精度を実証したとはしない。
- [ ] プライバシーポリシーの文面は公開前に専門家が確認する。PRにもこの公開前条件を明記する（CodexはPRを作成していない）。
- [ ] 受け渡したMarkdownは取消後に自動回収できないため、運営が最新版へ差し替えて利用を停止する。

## 今回実際に変更したファイル

- `PROGRESS.md`
- `scripts/test-insights-db.sh`
- `supabase/migrations/20261119000000_student_insights.sql`
- `src/app/account/page.tsx`
- `src/app/account/insights-actions.ts`
- `src/app/account/insights-form.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/insights-actions.ts`
- `src/app/admin/insights.tsx`
- `src/app/api/admin/insights/route.ts`
- `src/app/api/admin/insights/export/route.ts`
- `src/app/components/insights-consent.tsx`
- `src/app/globals.css`
- `src/app/privacy/page.tsx`
- `src/app/signup/actions.ts`
- `src/app/signup/signup-form.tsx`
- `src/lib/insights/extract.ts`
- `src/lib/insights/privacy.ts`
- `src/lib/insights/topics.ts`
- `src/lib/knowledge/embed.ts`
- `src/lib/knowledge/search.ts`
- `src/lib/usage.ts`
- `tests/fixtures/insights-schema.sql`
- `tests/fixtures/insights.ts`
- `tests/insights-actions.test.ts`
- `tests/insights-concurrency.py`
- `tests/insights-db.sql`
- `tests/insights-extract.test.ts`
- `tests/insights.test.ts`
- `tests/signup-insights.test.ts`

開始時から未追跡の `docs/plans/student-insights.md` と `node_modules` リンクは、この変更一覧には含めない。
