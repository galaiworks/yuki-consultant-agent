import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "YUKI AI",
  description: "YUKI 本人公認の AI に、ビジネス・キャリア・マインドセットを相談できるサービス(クライアント限定)",
  robots: { index: false, follow: false },
  // iPhone で「ホーム画面に追加」したとき、アプリとして全画面で開く
  appleWebApp: { capable: true, title: "YUKI AI", statusBarStyle: "default" },
};

/** アドレスバーやステータスバーの色(明るい・暗い表示それぞれ) */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f151c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kaku+Gothic+New:wght@700&display=swap"
        />
      </head>
      <body>
        {children}
        <footer className="site-footer">
          <Link href="/terms">利用規約</Link>
          <Link href="/privacy">プライバシーポリシー</Link>
          <Link href="/legal">特定商取引法に基づく表記</Link>
        </footer>
      </body>
    </html>
  );
}
