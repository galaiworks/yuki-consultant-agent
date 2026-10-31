"use client";

import { useState } from "react";

export function CheckoutButton({ planId, label }: { planId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.url) window.location.href = j.url;
    else {
      setError(j.error ?? "決済画面を開けませんでした");
      setBusy(false);
    }
  }
  return (
    <div className="row">
      <button type="button" onClick={start} disabled={busy}>{busy ? "移動中…" : label}</button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
