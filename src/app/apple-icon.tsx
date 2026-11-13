import { iconImage } from "./icon-image";

/** iPhone のホーム画面に追加したときのアイコン(180px。角丸は iOS が付ける) */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return iconImage(180);
}
