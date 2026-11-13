import { iconImage } from "../../icon-image";

/** manifest から参照するアイコン(/icons/192・/icons/512・/icons/maskable-512) */
const SIZES: Record<string, { size: number; maskable: boolean }> = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-512": { size: 512, maskable: true },
};

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const spec = SIZES[size];
  if (!spec) return new Response("Not found", { status: 404 });
  return iconImage(spec.size, spec.maskable);
}
