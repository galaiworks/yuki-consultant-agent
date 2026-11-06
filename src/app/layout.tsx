import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "YUKI AI",
  description: "YUKI 本人公認の AI に、ビジネス・キャリア・マインドセットを相談できるサービス(クライアント限定)",
  robots: { index: false, follow: false },
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
