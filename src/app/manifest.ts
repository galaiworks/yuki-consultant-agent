import type { MetadataRoute } from "next";

/** ホーム画面に追加したとき、アプリとして全画面で開くための設定(PWA の manifest) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YUKI AI",
    short_name: "YUKI AI",
    description: "YUKI 本人公認の AI に、ビジネス・キャリア・マインドセットを相談できるサービス(クライアント限定)",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#1f4f8f",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
