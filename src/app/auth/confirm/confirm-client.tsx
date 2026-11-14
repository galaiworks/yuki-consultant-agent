"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/** URL のハッシュは最初の 1 回だけ読む(開発時の再実行で、消したあとのハッシュを読まないため) */
let capturedHash: URLSearchParams | null = null;
let probing: Promise<[
  Awaited<ReturnType<ReturnType<typeof createClient>["auth"]["refreshSession"]>>,
  Awaited<ReturnType<ReturnType<typeof createSupabaseBrowserClient>["auth"]["getUser"]>>,
]> | null = null;
function takeHash(): URLSearchParams {
  if (!capturedHash) {
    capturedHash = new URLSearchParams(window.location.hash.slice(1));
    // 受け取ったトークンをアドレスバーと履歴に残さない
    window.history.replaceState(null, "", window.location.pathname);
  }
  return capturedHash;
}

type Pending = { accessToken: string; refreshToken: string; email: string; currentEmail: string | null };

/**
 * メールのリンクの「#access_token=…」を受け取り、ログイン状態(Cookie)に保存して相談画面へ進む。
 * リンクを申し込んだブラウザと開いたブラウザが違っても通る(PKCE の合い言葉を使わない方式)。
 * 他人のトークン入りリンクを踏まされて別アカウントでログインさせられないよう、
 * 保存の前にログイン先のメールアドレスを見せ、本人がボタンを押したときだけ保存する。
 */
export function ConfirmClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = takeHash();
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setError(
        hash.get("error_code") === "otp_expired"
          ? "このリンクは期限切れか、すでに使われています。ログイン画面からもう一度メールを送り、いちばん新しいメールのリンクを開いてください。"
          : "リンクが正しくありません。ログイン画面からもう一度お試しください。",
      );
      return;
    }
    // リンクの確認は、今のログイン状態(Cookie)と切り離した使い捨てのクライアントで行う。
    // 失敗しても今のログインが消えないようにするため
    const probe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    // refresh token を一度だけ新しい組に取り替え、その組の持ち主をログイン先として表示する。
    // access token と refresh token を別人のものと混ぜられても、表示と実際のログイン先がずれない
    // 開発時に useEffect が 2 回動いても、取り替えは 1 回だけにする
    probing ??= Promise.all([probe.auth.refreshSession({ refresh_token: refreshToken }), createSupabaseBrowserClient().auth.getUser()]);
    probing.then(
      ([fresh, current]) => {
        const session = fresh.data.session;
        const email = session?.user.email;
        if (fresh.error || !session || !email) {
          setError("リンクが正しくないか、期限切れです。ログイン画面からもう一度お試しください。");
          return;
        }
        setPending({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          email,
          currentEmail: current.data.user?.email ?? null,
        });
      },
    );
  }, []);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const { error: e } = await createSupabaseBrowserClient().auth.setSession({
      access_token: pending.accessToken,
      refresh_token: pending.refreshToken,
    });
    if (e) {
      setBusy(false);
      setError("ログインできませんでした。ログイン画面からもう一度お試しください。");
      return;
    }
    router.replace("/chat");
    router.refresh();
  }

  if (error) {
    return (
      <div className="card">
        <p className="error">{error}</p>
        <a href="/login">ログイン画面へ</a>
      </div>
    );
  }
  if (!pending) return <p className="muted">確認しています…</p>;
  return (
    <div className="card">
      <p>
        <strong>{pending.email}</strong> でログインします。
      </p>
      {pending.currentEmail && pending.currentEmail !== pending.email && (
        <p className="error">今は {pending.currentEmail} でログインしています。続けると、このアカウントに切り替わります。</p>
      )}
      <p className="muted" style={{ fontSize: 13 }}>ご自分で申し込んだリンクでなければ、ログインせずにこの画面を閉じてください。</p>
      <button type="button" onClick={confirm} disabled={busy}>
        {busy ? "ログイン中…" : "このアカウントでログインする"}
      </button>
      <a href="/login">やめる</a>
    </div>
  );
}
