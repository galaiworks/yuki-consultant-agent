import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "YUKI AI",
  description: "YUKI 本人公認の AI に、ビジネス・キャリア・マインドセットを相談できるサービス(クライアント限定)",
  robots: { index: false, follow: false },
  // iPhone で「ホーム画面に追加」したとき、アプリとして全画面で開く
  appleWebApp: { capable: true, title: "YUKI AI", statusBarStyle: "black-translucent" },
};

/** 常に黒の配色に合わせてアドレスバーとステータスバーを整える */
export const viewport: Viewport = {
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&family=Noto+Sans+JP:wght@400;500;700&display=swap"
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
