import { iconImage } from "./icon-image";

/** ブラウザのタブに出るアイコン */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return iconImage(64);
}
