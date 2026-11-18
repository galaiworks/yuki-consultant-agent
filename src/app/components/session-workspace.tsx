"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { conversationLabel, conversationPage, isNearLogBottom, mergeConversations, nextThinkingLine, SESSION_PAGE_SIZE, type Conversation } from "@/lib/ui/sessions";

const SessionContext = createContext<(row: Conversation) => void>(() => {});
/** 作成・更新した会話を両画面の一覧に反映する */
export const useUpdateSession = () => useContext(SessionContext);

/** 両画面で同じ会話一覧を使い、スマホではモーダルの引き出しにする */
export function SessionWorkspace({ initial, activeId, activeConversation, mode, children }: {
  initial: Conversation[]; activeId: string | null; activeConversation?: Conversation | null; mode: "chat" | "voice"; children: ReactNode;
}) {
  const firstPage = conversationPage(initial);
  const [items, setItems] = useState(() => mergeConversations(firstPage.items, activeConversation ? [activeConversation] : []));
  const [hasMore, setHasMore] = useState(firstPage.hasMore);
  const cursor = useRef(firstPage.items.at(-1));
  const [selected, setSelected] = useState(activeId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const drawer = useRef<HTMLDialogElement>(null);

  // 表示可能な高さに合わせ、iPhone のキーボード表示中も操作欄を隠さない。
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      document.body.style.setProperty("--session-height", `${viewport?.height ?? window.innerHeight}px`);
      document.body.style.setProperty("--session-top", `${viewport?.offsetTop ?? 0}px`);
      document.body.dataset.sessionKeyboard = String(Boolean(viewport && window.innerHeight - viewport.height > 120));
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.body.style.removeProperty("--session-height");
      document.body.style.removeProperty("--session-top");
      delete document.body.dataset.sessionKeyboard;
    };
  }, []);

  /** 追加読み込みも anon キーと本人のセッションを使い、RLS を通す */
  async function loadMore() {
    if (loading || !cursor.current) return;
    setLoading(true);
    setError("");
    try {
      const last = cursor.current;
      const { data, error } = await createSupabaseBrowserClient().from("conversations")
        .select("id, title, updated_at")
        .or(`updated_at.lt.${last.updated_at},and(updated_at.eq.${last.updated_at},id.lt.${last.id})`)
        .order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(SESSION_PAGE_SIZE + 1);
      if (error) throw error;
      const page = conversationPage((data ?? []) as Conversation[]);
      setItems((prev) => mergeConversations(prev, page.items));
      setHasMore(page.hasMore);
      cursor.current = page.items.at(-1);
    } catch {
      setError("会話一覧を読み込めませんでした。もう一度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  const updateSession = (row: Conversation) => {
    setSelected(row.id);
    setItems((prev) => {
      const old = prev.find((item) => item.id === row.id);
      const title = old?.title ? (row.title?.startsWith("(声)") && !old.title.startsWith("(声)") ? `(声)${old.title}` : old.title) : row.title;
      return mergeConversations(prev, [{ ...row, title }]);
    });
  };
  const list = (
    <>
      {/* 通常遷移で未送信の「新しい相談」も確実に初期化する。 */}
      <a className="new-session" href={`/${mode}`}>＋ 新しい相談</a>
      <h2>会話の一覧</h2>
      <div className="session-list">
        {items.length === 0 && <p className="muted">相談を始めると、ここに履歴が残ります。</p>}
        {items.map((row) => {
          const label = conversationLabel(row.title);
          return (
            <Link key={row.id} href={`/${mode}?c=${row.id}`} className="session-link" aria-current={row.id === selected ? "page" : undefined} onClick={() => drawer.current?.close()}>
              <span>{label.voice && <span className="voice-mark" aria-label="声の会話">◎ </span>}{label.title}</span>
              <time dateTime={row.updated_at}>{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(row.updated_at))}</time>
            </Link>
          );
        })}
        {hasMore && <button type="button" className="secondary" disabled={loading} onClick={loadMore}>{loading ? "読み込み中…" : "もっと見る"}</button>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </>
  );

  return (
    <SessionContext.Provider value={updateSession}>
      <div className="session-workspace">
        <aside className="session-sidebar" aria-label="会話の一覧">{list}</aside>
        <dialog ref={drawer} className="session-drawer" aria-label="会話の一覧" onClick={(e) => { if (e.target === e.currentTarget) drawer.current?.close(); }}>
          <button className="secondary drawer-close" type="button" onClick={() => drawer.current?.close()}>閉じる</button>
          {list}
        </dialog>
        <div className="session-main">
          <div className="session-toolbar">
            <button className="secondary drawer-open" type="button" onClick={() => drawer.current?.showModal()}>会話の一覧</button>
            <Link href={`/${mode === "chat" ? "voice" : "chat"}${selected ? `?c=${selected}` : ""}`}>{mode === "chat" ? "この会話を声で続ける" : "この会話を文字で続ける"}</Link>
          </div>
          {children}
        </div>
      </div>
    </SessionContext.Provider>
  );
}

/** 上を読み返している間は動かさず、下端にいるときだけログを追従させる */
export function ConversationLog({ children }: { children: ReactNode }) {
  const log = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const scroll = () => { if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight; };
  useLayoutEffect(scroll, [children]);
  useEffect(() => {
    const observer = new ResizeObserver(scroll);
    if (content.current) observer.observe(content.current);
    if (log.current) observer.observe(log.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="conversation-log" ref={log} role="log" aria-label="会話の履歴" tabIndex={0} onScroll={(e) => {
      const el = e.currentTarget;
      follow.current = isNearLogBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
    }}>
      <div className="conversation-log-content" ref={content}>{children}</div>
    </div>
  );
}

/** サーバーの状況が届くまでも空白を作らず、数秒ごとに一言を入れ替える */
export function ThinkingText({ status }: { status?: string }) {
  const [line, setLine] = useState(() => nextThinkingLine());
  useEffect(() => {
    if (status) return;
    const timer = setInterval(() => setLine(nextThinkingLine), 4000);
    return () => clearInterval(timer);
  }, [status]);
  return <span className="thinking-text"><span>{status || line}</span><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span></span>;
}
