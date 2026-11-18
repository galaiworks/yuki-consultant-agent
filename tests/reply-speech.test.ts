import { beforeEach, describe, expect, it, vi } from "vitest";
import { synthesize } from "@/lib/voice/elevenlabs";
import { createReplySpeech, REPLY_SPEECH_MAX_CHARS } from "@/lib/voice/reply-speech";

vi.mock("@/lib/voice/elevenlabs", async (original) => ({
  ...await original<typeof import("@/lib/voice/elevenlabs")>(), synthesize: vi.fn(),
}));
const tts = vi.mocked(synthesize);
beforeEach(() => { tts.mockReset(); tts.mockResolvedValue(new Uint8Array([1, 2]).buffer); });

describe("返事の自動読み上げ", () => {
  it("全文を待たず最初の文を作り、届いた順に音声を流す", async () => {
    const onAudio = vi.fn();
    const speech = createReplySpeech({ isOpen: () => true, onAudio, onError: vi.fn() });
    speech.push("はい。次の文はまだ途中");
    await vi.waitFor(() => expect(onAudio).toHaveBeenCalledTimes(1));
    expect(tts.mock.calls[0][0]).toBe("はい。");
    speech.push("です。");
    await speech.finish();
    expect(onAudio.mock.calls.map(([e]) => e.index)).toEqual([0, 1]);
    expect(tts.mock.calls[1][1]?.previousText).toBe("はい。");
  });
  it("句点がない返事でも、先頭 2500 文字までで読み上げを打ち切る", async () => {
    const speech = createReplySpeech({ isOpen: () => true, onAudio: vi.fn(), onError: vi.fn() });
    speech.push("あ".repeat(2000));
    speech.push("い".repeat(2000));
    speech.push("う".repeat(1000));
    expect(await speech.finish()).toBe(REPLY_SPEECH_MAX_CHARS);
    expect(tts.mock.calls[0][0]).toBe("あ".repeat(2000) + "い".repeat(500));
  });
  it("音声を直列に作り、前の文が終わるまでは次を頼まない", async () => {
    let resolve!: (audio: ArrayBuffer) => void;
    tts.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const speech = createReplySpeech({ isOpen: () => true, onAudio: vi.fn(), onError: vi.fn() });
    speech.push("一つ目です。二つ目です。");
    await vi.waitFor(() => expect(tts).toHaveBeenCalledTimes(1));
    resolve(new ArrayBuffer(0));
    await speech.finish();
    expect(tts).toHaveBeenCalledTimes(2);
  });
  it("途中で画面を閉じたら未着手の音声を作らず、着手分の費用は残す", async () => {
    let open = true;
    tts.mockImplementationOnce(async () => { open = false; return new ArrayBuffer(0); });
    const speech = createReplySpeech({ isOpen: () => open, onAudio: vi.fn(), onError: vi.fn() });
    speech.push("一つ目です。二つ目です。");
    expect(await speech.finish()).toBe("一つ目です。".length);
    expect(tts).toHaveBeenCalledTimes(1);
  });
  it("音声サービスが失敗しても文章の処理を止めず、費用用の文字数を返す", async () => {
    tts.mockRejectedValueOnce(new Error("失敗"));
    const onError = vi.fn();
    const speech = createReplySpeech({ isOpen: () => true, onAudio: vi.fn(), onError });
    speech.push("最初の返事です。次の文です。");
    expect(await speech.finish()).toBe("最初の返事です。".length);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(tts).toHaveBeenCalledTimes(1);
  });
  it("装飾だけの文は読み上げず、最後の句点のない文は読む", async () => {
    const speech = createReplySpeech({ isOpen: () => true, onAudio: vi.fn(), onError: vi.fn() });
    speech.push("***\n**最後の文**");
    expect(await speech.finish()).toBe("最後の文".length);
    expect(tts).toHaveBeenCalledWith("最後の文", { previousText: "" });
  });
});
