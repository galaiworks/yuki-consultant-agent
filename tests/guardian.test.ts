import { describe, expect, it } from "vitest";
import { AXES, buildFeedback, decideNextStep, MAX_RETRIES, normalizeEvaluation, type RawEvaluation } from "@/lib/agents/guardian";

function raw(scores: Partial<Record<keyof typeof AXES, number>>, critical = false): RawEvaluation {
  const axes = {} as RawEvaluation["axes"];
  for (const k of Object.keys(AXES) as (keyof typeof AXES)[]) {
    axes[k] = { score: scores[k] ?? AXES[k].max, issues: scores[k] !== undefined ? [`${k} を直す`] : [] };
  }
  return { axes, critical_violation: critical, critical_reason: critical ? "なりすまし" : "" };
}

describe("normalizeEvaluation", () => {
  it("配点の合計は 100", () => {
    expect(Object.values(AXES).reduce((n, a) => n + a.max, 0)).toBe(100);
  });

  it("合計はコードで計算し、配点の範囲に収める", () => {
    const ev = normalizeEvaluation(raw({ evidence: 40, overpromise: -3 }));
    expect(ev.axes.evidence.score).toBe(25);
    expect(ev.axes.overpromise.score).toBe(0);
    expect(ev.total).toBe(95);
  });
});

describe("decideNextStep(95 点ループ)", () => {
  const approve = { judgment: "approve" as const, reason: "ok" };

  it("95 点以上で自己反省も approve なら合格", () => {
    expect(decideNextStep(normalizeEvaluation(raw({})), 0, approve)).toEqual({ action: "approve" });
  });

  it("95 点ちょうどは合格ライン", () => {
    expect(decideNextStep(normalizeEvaluation(raw({ client_fit: 10 })), 0, approve).action).toBe("approve");
  });

  it("94 点は作り直し", () => {
    const step = decideNextStep(normalizeEvaluation(raw({ client_fit: 9 })), 0);
    expect(step.action).toBe("revise");
  });

  it("95 点以上でも自己反省で reject なら作り直し", () => {
    const step = decideNextStep(normalizeEvaluation(raw({})), 1, { judgment: "reject", reason: "出典が弱い" });
    expect(step).toMatchObject({ action: "revise" });
    if (step.action === "revise") expect(step.feedback).toContain("出典が弱い");
  });

  it("自己反省が needs_review なら人へ", () => {
    expect(decideNextStep(normalizeEvaluation(raw({})), 0, { judgment: "needs_review", reason: "?" })).toEqual({
      action: "escalate",
      reason: "ambiguous_judgment",
    });
  });

  it(`作り直しが ${MAX_RETRIES} 回に達したら人へ`, () => {
    expect(decideNextStep(normalizeEvaluation(raw({ evidence: 10 })), MAX_RETRIES)).toEqual({
      action: "escalate",
      reason: "max_retries_exceeded",
    });
  });

  it("重大な問題は点数に関係なく即停止", () => {
    expect(decideNextStep(normalizeEvaluation(raw({}, true)), 0, approve)).toEqual({ action: "escalate", reason: "critical_violation" });
  });
});

describe("buildFeedback", () => {
  it("配点の 9 割に届かない軸の指摘だけを渡す", () => {
    const fb = buildFeedback(normalizeEvaluation(raw({ evidence: 20, yuki_fidelity: 24 })));
    expect(fb).toContain("根拠と出典");
    expect(fb).not.toContain("YUKIらしさ");
  });
});
