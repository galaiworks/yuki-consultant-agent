import { ImageResponse } from "next/og";

/**
 * アプリのアイコン画像を作る(藍色の地に白い「YUKI」)。
 * maskable は Android が丸や角丸に切り抜くため、文字を中央 60% に収める。
 */
export function iconImage(size: number, maskable = false): ImageResponse {
  const fontSize = Math.round(size * (maskable ? 0.17 : 0.22));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1f4f8f",
          color: "#ffffff",
          fontSize,
          fontWeight: 700,
          letterSpacing: fontSize * 0.04,
        }}
      >
        YUKI
      </div>
    ),
    { width: size, height: size },
  );
}
