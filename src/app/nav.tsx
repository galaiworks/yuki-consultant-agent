import Link from "next/link";
import { currentUserIsAdmin } from "@/lib/admin/guard";

/** ログイン後の共通ナビ */
export async function Nav() {
  const { user, isAdmin } = await currentUserIsAdmin();
  const mustChange = Boolean(user?.user_metadata?.must_change_password);
  return (
    <>
      <nav className="nav" aria-label="メインナビゲーション">
        <div className="nav-head">
          <Link className="brand" href="/chat" aria-label="YUKI AI 相談">
            <img className="avatar" src="/yuki/avatar.jpg" alt="" width={40} height={40} />
            <span className="brand-copy"><strong>YUKI</strong><small>AI CONSULTANT</small></span>
          </Link>
          <details className="nav-menu">
            <summary aria-label="メニュー"><span aria-hidden="true">≡</span><span className="sr-only">メニュー</span></summary>
            <div className="nav-menu-panel">
              <Link href="/billing"><span lang="en">Plan</span> プラン</Link>
              <form action="/auth/signout" method="post">
                <button className="secondary" type="submit">ログアウト</button>
              </form>
            </div>
          </details>
        </div>
        <div className="nav-tabs">
          <Link className="nav-tab" href="/chat"><span className="nav-icon" aria-hidden="true">◆</span><span className="nav-label" lang="en">Consult</span><small>相談</small></Link>
          <Link className="nav-tab" href="/voice"><span className="nav-icon" aria-hidden="true">◎</span><span className="nav-label" lang="en">Voice</span><small>声で話す</small></Link>
          <Link className="nav-tab" href="/deliverables"><span className="nav-icon" aria-hidden="true">▤</span><span className="nav-label" lang="en">Library</span><small>成果物</small></Link>
          <Link className="nav-tab" href="/account"><span className="nav-icon" aria-hidden="true">○</span><span className="nav-label" lang="en">Account</span><small>アカウント</small></Link>
          {isAdmin && <Link className="nav-tab" href="/admin"><span className="nav-icon" aria-hidden="true">◇</span><span className="nav-label" lang="en">Admin</span><small>管理</small></Link>}
        </div>
      </nav>
      {mustChange && (
        <p className="notice">
          仮パスワードでログインしています。<Link href="/account">アカウント</Link>から自分のパスワードに変更してください。
        </p>
      )}
    </>
  );
}
