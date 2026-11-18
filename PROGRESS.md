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
