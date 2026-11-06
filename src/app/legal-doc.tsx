import Link from "next/link";

/** 規約・ポリシーなどの文書ページの共通の枠 */
export function LegalDoc({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="shell legal" style={{ maxWidth: 760 }}>
      <p><Link href="/chat">← YUKI AI に戻る</Link></p>
      <h1>{title}</h1>
      <p className="notice">
        これは公開前の案です。内容は弁護士の確認を経て確定します。[ ] の部分は確定後に入ります。(最終更新: {updated})
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, lineHeight: 1.8 }}>{children}</div>
    </main>
  );
}
