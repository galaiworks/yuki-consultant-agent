import { describe, expect, it } from "vitest";
import { DISCLAIMER_PATTERN_SOURCE, decidePacing, pacingFromCounts, hasDisclaimer, isClosingSignal, pacingInstructions, FIRM_CLOSE_TURN, SOFT_CLOSE_TURN } from "@/lib/agents/pacing";
import { isReservedEmail, parseSignup, passProblem } from "@/lib/signup";
import { decideAccess } from "@/lib/access";

/** n 往復ぶんの履歴を作る */
const turns = (n: number, assistantText = "なるほど。") =>
  Array.from({ length: n }, () => [
    { role: "user" as const, text: "相談です" },
    { role: "assistant" as const, text: assistantText },
  ]).flat();

describe("decidePacing: 往復数で締めに向かう", () => {
  it("はじめは広げてよい段階", () => {
    expect(decidePacing({ history: [], userMessage: "集客で悩んでいます" }).stage).toBe("explore");
  });
  it(`${SOFT_CLOSE_TURN} 往復目から締めに向かう`, () => {
    expect(decidePacing({ history: turns(SOFT_CLOSE_TURN - 1), userMessage: "続きです" })).toMatchObject({ turn: SOFT_CLOSE_TURN, stage: "soft_close" });
  });
  it(`${FIRM_CLOSE_TURN} 往復目で締める`, () => {
    expect(decidePacing({ history: turns(FIRM_CLOSE_TURN - 1), userMessage: "続きです" }).stage).toBe("firm_close");
  });
});

describe("decidePacing: 終わりの合図", () => {
  it("3 往復目以降のお礼で締める", () => {
    expect(decidePacing({ history: turns(2), userMessage: "ありがとうございます、やってみます" }).stage).toBe("firm_close");
  });
  it("話し始めのお礼では締めない", () => {
    expect(decidePacing({ history: [], userMessage: "ありがとうございます" }).stage).toBe("explore");
  });
  it("「わかりました、では〇〇は?」は続けたい合図なので締めない", () => {
    expect(decidePacing({ history: turns(3), userMessage: "わかりました。では価格はどう決めますか?" }).stage).toBe("explore");
  });
  it("「最後に一つ」は質問付きでも締める", () => {
    expect(decidePacing({ history: turns(3), userMessage: "最後に一つだけ聞いてもいいですか?" }).stage).toBe("firm_close");
  });
});

describe("decidePacing: 断り書きの回数", () => {
  it("まだ使っていなければ未使用", () => {
    expect(decidePacing({ history: turns(2), userMessage: "質問" }).disclaimerUsed).toBe(false);
  });
  it("一度使っていれば使用済み", () => {
    const h = turns(2, "これは動画では直接話していないんですけど、一般的には");
    expect(decidePacing({ history: h, userMessage: "質問" }).disclaimerUsed).toBe(true);
  });
});

describe("pacingInstructions", () => {
  it("締める段階では問いかけで終えないよう指示する", () => {
    const text = pacingInstructions(decidePacing({ history: turns(FIRM_CLOSE_TURN), userMessage: "続き" }));
    expect(text).toContain("新しい質問はしません");
    expect(text).toContain("次回");
  });
  it("断り書きを使ったあとは繰り返さないよう指示する", () => {
    const text = pacingInstructions(decidePacing({ history: turns(1, "それは動画では話していないんですけど"), userMessage: "質問" }));
    expect(text).toContain("もう繰り返さず");
  });
});

describe("parseSignup", () => {
  const ok = { code: "abcd-efgh-jkmn-pqrs", email: " Yuki@Example.com ", password: "secret-123", confirm: "secret-123" };
  it("正しい入力を受け付け、コードとメールをそろえる", () => {
    const r = parseSignup(ok);
    expect(r).toEqual({ ok: true, value: { code: "ABCDEFGHJKMNPQRS", email: "yuki@example.com", name: undefined, password: "secret-123" } });
  });
  it("短いパスワードを断る", () => {
    expect(parseSignup({ ...ok, password: "short", confirm: "short" })).toMatchObject({ ok: false, error: expect.stringContaining("8 文字以上") });
  });
  it("確認用と違うパスワードを断る", () => {
    expect(parseSignup({ ...ok, confirm: "different-1" })).toMatchObject({ ok: false, error: expect.stringContaining("一致しません") });
  });
  it("6 文字のコード(NLB-WIN)を受け付ける", () => {
    expect(parseSignup({ ...ok, code: "NLB-WIN" })).toMatchObject({ ok: true, value: { code: "NLBWIN" } });
  });
  it("コードが空なら断る", () => {
    expect(parseSignup({ ...ok, code: "" })).toMatchObject({ ok: false, error: expect.stringContaining("チケットコード") });
  });
});

describe("passProblem", () => {
  const now = new Date("2026-11-19T00:00:00Z");
  const pass = { revoked_at: null, expires_at: null, redemption_count: 0, max_redemptions: 1 };
  it("使えるチケットなら問題なし", () => expect(passProblem(pass, now)).toBeNull());
  it("見つからない", () => expect(passProblem(null, now)).toBe("pass_not_found"));
  it("無効化済み", () => expect(passProblem({ ...pass, revoked_at: "2026-11-01" }, now)).toBe("pass_revoked"));
  it("期限切れ", () => expect(passProblem({ ...pass, expires_at: "2026-11-18T00:00:00Z" }, now)).toBe("pass_expired"));
  it("上限に達した", () => expect(passProblem({ ...pass, redemption_count: 1 }, now)).toBe("pass_used_up"));
});

describe("isClosingSignal: 続けたい発言を終わりと誤判定しない", () => {
  it.each([
    "わかりました。では価格の決め方を教えてください。",
    "お客様から『大丈夫です』と言われて断られます",
    "お客さんに「ありがとう」と言われるんですが、リピートしません",
    "わかりました、じゃあ次に集客の話をしたいです",
    "まだ最後にはしないでください",
    "営業では最後に『ありがとう』と言われますが、契約につながりません",
  ])("続けたい: %s", (m) => expect(isClosingSignal(m)).toBe(false));
  it.each(["ありがとうございました!", "わかりました。やってみます", "参考になりました", "最後に一つだけいいですか?", "それでは、ありがとうございました"])("終わり: %s", (m) =>
    expect(isClosingSignal(m)).toBe(true),
  );
});

describe("hasDisclaimer: 言い方の違いも拾う", () => {
  it.each(["動画では話していません", "動画で話していないんですけど", "動画では直接話していない領域です", "動画ではお話ししていないんですが", "動画では触れていませんが"])(
    "%s",
    (t) => expect(hasDisclaimer(t)).toBe(true),
  );
  it("関係ない文は拾わない", () => expect(hasDisclaimer("動画でもお話ししたんですけど")).toBe(false));
});

describe("decidePacing: 長い会話でも数え直さない", () => {
  it("最初に断り書きを使えば、11 往復目でも使用済み", () => {
    const h = [{ role: "user" as const, text: "相談" }, { role: "assistant" as const, text: "これは動画では話していないんですけど" }, ...turns(10)];
    expect(decidePacing({ history: h, userMessage: "続き" })).toMatchObject({ turn: 12, disclaimerUsed: true, stage: "firm_close" });
  });
});

describe("isReservedEmail", () => {
  it("管理者のメールアドレスでは登録させない", () => expect(isReservedEmail("Admin@Example.com", ["admin@example.com"])).toBe(true));
  it("それ以外は登録できる", () => expect(isReservedEmail("yuki@example.com", ["admin@example.com"])).toBe(false));
});

describe("decidePacing: DB で数えた回数を使う", () => {
  it("直近の履歴に断り書きがなくても、DB で使用済みなら使用済み", () => {
    expect(decidePacing({ history: turns(2), priorUserTurns: 201, disclaimerUsed: true, userMessage: "続き" })).toMatchObject({
      turn: 202,
      disclaimerUsed: true,
      stage: "firm_close",
    });
  });
  it("DB と同じ正規表現の文字列で断り書きを見分ける", () => {
    expect(new RegExp(DISCLAIMER_PATTERN_SOURCE).test("動画では話していないんですけど")).toBe(true);
  });
});

describe("decideAccess: 登録途中は使えない", () => {
  const plans = [{ id: "founding", name: "Founding", monthly_usage_limit_usd: 30 }];
  const base = { mode: "open" as const, isAdmin: false, subscriptions: [], plans, defaultPlanId: "founding", usageThisMonthUsd: 0, now: new Date() };
  it("登録途中なら open モードでも使えない", () => expect(decideAccess({ ...base, signupPending: true }).allowed).toBe(false));
  it("登録が済めば使える", () => expect(decideAccess({ ...base, signupPending: false }).allowed).toBe(true));
});

describe("pacingFromCounts: 数えられなかったときは安全側", () => {
  it("断り書きを数えられなければ使用済み扱い(繰り返さない)", () => expect(pacingFromCounts({ userCount: 11, disclaimerCount: null })).toEqual({ priorUserTurns: 11, disclaimerUsed: true }));
  it("往復数を数えられなければ履歴で数える(値を渡さない)", () => expect(pacingFromCounts({ userCount: null, disclaimerCount: 0 })).toEqual({ disclaimerUsed: false }));
  it("両方数えられれば、その値を使う", () => expect(pacingFromCounts({ userCount: 3, disclaimerCount: 2 })).toEqual({ priorUserTurns: 3, disclaimerUsed: true }));
});
