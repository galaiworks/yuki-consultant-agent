import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YUKI Consultant Agent",
  description: "米国ビジネスコンサル YUKI さんの知見をもとにした AI 経営相談(クライアント限定)",
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
      <body>{children}</body>
    </html>
  );
}
