# UI 刷新：黒×ゴールドの「YUKI のツール」に

## 目的
YUKI AI の見た目を、アメリカのコンサルタント YUKI さん（NEXT LEVEL BIZZ CEO）のツールだとひと目で分かる、黒×ゴールドの高級感あるデザインにする。

## 方針（承認済み）
- 配色：黒地に細いゴールド。会員制サロンのようなプレミアム感。明るい表示モードは作らず、常に暗い配色（color-scheme: dark）。
- 写真：`public/yuki/portrait.jpg`（900px）と `public/yuki/avatar.jpg`（256px）。出典は NEXT LEVEL BIZZ ACADEMY 公式サイトの CEO 写真。ガライさんの承認を得て使用する。
- 文字：英字の見出しはセリフ体（Google Fonts の Cormorant Garamond など）、本文は Noto Sans JP のまま。英語のラベル（例：「Consult」「Voice」）を日本語の補助として使い、米国のコンサルらしさを出す。日本語の説明は削らない。

## 見本（正）
`mockups/index.html`（A案）を見た目の正とする。ブラウザで開いて確認し、配色トークン・フォント・部品の形をそこからそのまま使う。
- ログイン：写真を上半分いっぱいに置き、下を黒へぼかす。セリフ体の「YUKI」と金の小さな「AI CONSULTANT · LOS ANGELES」。
- 相談：ヘッダーに金の縁の丸写真と「YUKI / AI Consultant」。YUKI の回答に丸写真を付け、黒い吹き出し、太字は明るい金。相談者は淡い金の吹き出し。出典は金の線の小さな札。入力欄は丸く、送信は金の丸ボタン。
- 声：写真の周りに金の波紋（CSS アニメーション、prefers-reduced-motion では止める）。大きな金のマイクボタン。
- ナビ：スマホ（幅 768px 未満）は画面下のタブ（Consult 相談／Voice 声／Library 成果物／Account アカウント、管理者には Admin）。パソコンは上部または左のメニュー。ログアウトはアカウント画面またはメニュー内に置く。

## 変更範囲
- `src/app/globals.css`：配色トークン、ナビ、カード、ボタン、チャットの吹き出し、入力欄の全面的な見直し。
- `src/app/layout.tsx`：フォント読み込みと themeColor（黒）、appleWebApp の statusBarStyle を `black-translucent`。
- `src/app/nav.tsx`：ブランド表示を「YUKI」＋小さな「AI CONSULTANT」と丸いアバター写真に。
- `src/app/login/page.tsx`：ポートレート写真を大きく使ったログイン画面。
- `src/app/chat/page.tsx`・`chat-client.tsx`・`voice/page.tsx`：YUKI の回答にアバターを付ける、相談が空のときの歓迎表示（写真＋一言）。
- `src/proxy.ts`：ログイン前の画面でも写真が出るよう、matcher の除外に `yuki/(?:portrait|avatar)\.jpg$` を足す（完全一致）。

## 変えないこと
- 文言の意味・注意書き（AI である旨、専門家への確認）・法的ページの内容。
- ロジック（API・状態管理・読み上げ・認証）。見た目のための JSX とクラス名の変更だけにする。

## 受け入れ条件
1. `npx tsc --noEmit` と `npx vitest run` が通る。
2. ログイン・チャット・声・プラン・アカウント・管理の各画面が黒×ゴールドで崩れず表示される（幅 375px と 1280px）。
3. 文字と背景のコントラストが本文で 4.5:1 以上。
4. 写真はログイン前の画面でも表示される。
5. ロジックの差分が無い（`git diff` で見た目以外の変更が無い）。

## テスト方法
tsc・vitest・ローカルの `npm run dev` を幅 375 と 1280 で画面確認。
