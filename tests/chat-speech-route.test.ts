import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { synthesize } from "@/lib/voice/elevenlabs";
import { recordSpeechUsage } from "@/lib/usage";
import { runLeadConsultant, type ChatEvent } from "@/lib/agents/lead";

const state = vi.hoisted(() => ({ voiceEnabled: true, loggedIn: true, allowed: true, owns: true, history: [] as { role: string; text: string }[] }));
const conversationId = "00000000-0000-4000-8000-000000000001";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/config", async (original) => ({
  ...await original<typeof import("@/lib/config")>(), appConfig: { get voiceEnabled() { return state.voiceEnabled; } },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => database() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => database() }));
vi.mock("@/lib/access", () => ({ getAccessForCurrentUser: async () => state.allowed ? { allowed: true } : { allowed: false, reason: "usage_limit_reached" } }));
vi.mock("@/lib/persona", () => ({ loadPersona: async () => ({}) }));
vi.mock("@/lib/knowledge/search", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/agents/deliverable-loop", () => ({ processNextDeliverable: vi.fn() }));
vi.mock("@/lib/agents/pacing", () => ({
  MODEL_HISTORY_LIMIT: 20, countPacing: async () => ({}), pacingFromCounts: () => ({}), decidePacing: () => ({}), pacingInstructions: () => "",
}));
vi.mock("@/lib/agents/lead", () => ({ runLeadConsultant: vi.fn() }));
vi.mock("@/lib/voice/elevenlabs", async (original) => ({
  ...await original<typeof import("@/lib/voice/elevenlabs")>(), synthesize: vi.fn(),
}));
vi.mock("@/lib/usage", async (original) => ({
  ...await original<typeof import("@/lib/usage")>(), recordUsage: vi.fn(), recordSpeechUsage: vi.fn(),
}));

/** RLS 後の結果を模す。プロバイダ・DB には接続しない */
function database() {
  return {
    auth: { getUser: async () => ({ data: { user: state.loggedIn ? { id: "test-user" } : null } }) },
    from(table: string) {
      const result = () => ({ data: table === "messages" ? state.history : [], error: null });
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; },
        insert() { return query; }, update() { return query; },
        single: async () => ({ data: { id: conversationId }, error: null }),
        maybeSingle: async () => ({ data: state.owns ? { id: conversationId } : null, error: null }),
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(resolve(result())); },
      };
      return query;
    },
  };
}

const lead = vi.mocked(runLeadConsultant);
const tts = vi.mocked(synthesize);
function request(speak?: boolean, id: string | null = conversationId) {
  return new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: id, message: "売上の相談です", ...(speak === undefined ? {} : { speak }) }) });
}
async function events(response: Response): Promise<ChatEvent[]> {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { voiceEnabled: true, loggedIn: true, allowed: true, owns: true, history: [] });
  tts.mockReset();
  tts.mockResolvedValue(new Uint8Array([1]).buffer);
  lead.mockReset();
  lead.mockImplementation(async ({ deps }) => {
    deps.emit({ type: "text", text: "まずは一人に絞りましょう。" });
    return { text: "まずは一人に絞りましょう。", citations: [] };
  });
});
afterEach(() => vi.restoreAllMocks());

describe("チャットの音声イベントと利用制限", () => {
  it("オンなら返答の音声を送り、既存の音声利用料に記録する", async () => {
    const result = await events(await POST(request(true)));
    expect(result.some((event) => event.type === "audio")).toBe(true);
    expect(result.at(-1)?.type).toBe("done");
    expect(recordSpeechUsage).toHaveBeenCalledWith(expect.anything(), { userId: "test-user", conversationId }, "voice_tts", expect.any(String), expect.any(Number));
    expect(vi.mocked(recordSpeechUsage).mock.calls[0][4]).toBeGreaterThan(0);
  });
  it.each([false, undefined])("オフまたは旧クライアントのリクエストなら音声を作らない: %s", async (speak) => {
    const result = await events(await POST(request(speak)));
    expect(result.some((event) => event.type === "text")).toBe(true);
    expect(tts).not.toHaveBeenCalled();
    expect(recordSpeechUsage).not.toHaveBeenCalled();
  });
  it("サーバーの音声設定がオフなら、リクエストでオンにしても音声を作らない", async () => {
    state.voiceEnabled = false;
    await events(await POST(request(true)));
    expect(tts).not.toHaveBeenCalled();
  });
  it.each(["loggedIn", "allowed", "owns"] as const)("ログイン・利用上限・所有権で拒否されたら音声も返答も作らない: %s", async (key) => {
    state[key] = false;
    const response = await POST(request(true));
    expect(response.status).toBe(key === "loggedIn" ? 401 : key === "allowed" ? 402 : 404);
    expect(lead).not.toHaveBeenCalled();
    expect(tts).not.toHaveBeenCalled();
  });
  it("音声だけ失敗しても、文字の返答と saved・done を返す", async () => {
    tts.mockRejectedValueOnce(new Error("音声のみ失敗"));
    const result = await events(await POST(request(true)));
    expect(result.map((e) => e.type)).toEqual(expect.arrayContaining(["text", "speech_error", "saved", "done"]));
    expect(result.some((e) => e.type === "error")).toBe(false);
    expect(recordSpeechUsage).toHaveBeenCalledTimes(1);
  });
  it("返答が途中で失敗しても、先に作った音声の費用を記録する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    lead.mockImplementationOnce(async ({ deps }) => {
      deps.emit({ type: "text", text: "最初の返事です。" });
      throw new Error("途中で失敗");
    });
    const result = await events(await POST(request(true)));
    expect(result.some((e) => e.type === "error")).toBe(true);
    expect(recordSpeechUsage).toHaveBeenCalledTimes(1);
  });
  it("文字ストリームが終わる前に、最初の文の音声イベントを受け取れる", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    lead.mockImplementationOnce(async ({ deps }) => {
      deps.emit({ type: "text", text: "最初の返事です。" });
      await pending;
      deps.emit({ type: "text", text: "続きです。" });
      return { text: "最初の返事です。続きです。", citations: [] };
    });
    const response = await POST(request(true));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    try {
      for (let i = 0; i < 5 && !received.includes('"type":"audio"'); i++) {
        const chunk = await reader.read();
        received += decoder.decode(chunk.value);
      }
      expect(received).toContain('"type":"audio"');
      expect(received).not.toContain("続きです。");
    } finally {
      finish();
      while (!(await reader.read()).done) { /* 完了まで読み、バックグラウンド処理を残さない */ }
    }
  });
});
