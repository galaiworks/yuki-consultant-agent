"use client";

import { useActionState } from "react";
import {
  createClientAction,
  createPassAction,
  resetPasswordAction,
  type ActionResult,
} from "@/app/admin/actions";

function Result({ state }: { state: ActionResult }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (!state.ok) return null;
  return (
    <div className="notice" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span>{state.ok}</span>
      {state.secret && (
        <code style={{ fontSize: 16, userSelect: "all", color: "var(--ink)" }}>{state.secret}</code>
      )}
    </div>
  );
}

export function CreateClientForm({ siteUrl }: { siteUrl: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createClientAction, {});
  return (
    <form className="card" action={action}>
      <h2 style={{ fontSize: 18 }}>クライアントを登録</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        登録すると仮パスワードが表示されます。ログインURL({siteUrl}/login)と一緒に本人へ伝えてください。
      </p>
      <label htmlFor="c-email">メールアドレス<input id="c-email" name="email" type="email" required /></label>
      <label htmlFor="c-name">名前<input id="c-name" name="name" /></label>
      <label htmlFor="c-company">会社名<input id="c-company" name="company" /></label>
      <label htmlFor="c-industry">業種<input id="c-industry" name="industry" /></label>
      <label htmlFor="c-role">
        権限
        <select id="c-role" name="role" defaultValue="client">
          <option value="client">クライアント</option>
          <option value="admin">管理者</option>
        </select>
      </label>
      <button type="submit" disabled={pending}>{pending ? "登録中…" : "登録する"}</button>
      <Result state={state} />
    </form>
  );
}

export function ResetPasswordButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(resetPasswordAction, {});
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className="secondary" disabled={pending} style={{ padding: "4px 10px", fontSize: 13 }}>
        {pending ? "発行中…" : "仮パスワード再発行"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function CreatePassForm({ plans }: { plans: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createPassAction, {});
  return (
    <form className="card" action={action}>
      <h2 style={{ fontSize: 18 }}>特別チケットを発行</h2>
      <p className="muted" style={{ fontSize: 13 }}>課金開始後(ACCESS_MODE=paid)も、このコードを入れた人は期間中無料で使えます。</p>
      <label htmlFor="p-plan">
        プラン
        <select id="p-plan" name="plan" defaultValue={plans[0]?.id}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label htmlFor="p-days">利用できる日数<input id="p-days" name="days" type="number" min={1} defaultValue={30} required /></label>
      <label htmlFor="p-uses">使える人数<input id="p-uses" name="uses" type="number" min={1} defaultValue={1} required /></label>
      <label htmlFor="p-label">メモ(誰向けか)<input id="p-label" name="label" /></label>
      <button type="submit" disabled={pending}>{pending ? "発行中…" : "発行する"}</button>
      <Result state={state} />
    </form>
  );
}
