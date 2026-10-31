import Link from "next/link";

/** ログイン後の共通ナビ */
export function Nav() {
  return (
    <nav className="nav">
      <Link className="brand" href="/chat">YUKI Consultant Agent</Link>
      <Link href="/chat">相談</Link>
      <Link href="/deliverables">成果物</Link>
      <Link href="/billing">プラン</Link>
      <form action="/auth/signout" method="post">
        <button className="secondary" type="submit">ログアウト</button>
      </form>
    </nav>
  );
}
