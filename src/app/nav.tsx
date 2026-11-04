import Link from "next/link";
import { currentUserIsAdmin } from "@/lib/admin/guard";

/** ログイン後の共通ナビ */
export async function Nav() {
  const { user, isAdmin } = await currentUserIsAdmin();
  const mustChange = Boolean(user?.user_metadata?.must_change_password);
  return (
    <>
      <nav className="nav">
        <Link className="brand" href="/chat">YUKI Consultant Agent</Link>
        <Link href="/chat">相談</Link>
        <Link href="/deliverables">成果物</Link>
        <Link href="/billing">プラン</Link>
        <Link href="/account">アカウント</Link>
        {isAdmin && <Link href="/admin">管理</Link>}
        <form action="/auth/signout" method="post">
          <button className="secondary" type="submit">ログアウト</button>
        </form>
      </nav>
      {mustChange && (
        <p className="notice">
          仮パスワードでログインしています。<Link href="/account">アカウント</Link>から自分のパスワードに変更してください。
        </p>
      )}
    </>
  );
}
