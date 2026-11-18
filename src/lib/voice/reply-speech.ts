import { synthesize, toSpeakable } from "@/lib/voice/elevenlabs";
import { addThinkingPauses, bracketDepth, SentenceSplitter } from "@/lib/voice/sentences";

/** 返答の先頭から数える文字数。表示用の原文で上限を固定し、装飾を除いても増やさない */
export const REPLY_SPEECH_MAX_CHARS = 2500;

/** 返答ストリームだけを受け取り、書けた文から順番に音声を作る */
export function createReplySpeech(options: {
  isOpen: () => boolean;
  onAudio: (event: { type: "audio"; index: number; audio: string }) => void;
  onError: () => void;
}) {
  const splitter = new SentenceSplitter(1);
  let accepted = 0;
  let spoken = "";
  let depth = 0;
  let index = 0;
  let chars = 0;
  let speech = Promise.resolve();
  let failed = false;

  /** 文の読み上げは直列化し、音声サービスの同時呼び出しを増やさない */
  function speak(sentence: string) {
    const speakable = toSpeakable(sentence);
    if (!speakable) return;
    const previousText = spoken;
    spoken += speakable;
    const text = addThinkingPauses(speakable, depth);
    depth = bracketDepth(speakable, depth);
    const i = index++;
    speech = speech.then(async () => {
      if (!options.isOpen() || failed) return;
      // 失敗したリクエストも費用が発生しうるため、送った文字数を記録する。
      chars += text.length;
      try {
        const audio = Buffer.from(await synthesize(text, { previousText })).toString("base64");
        options.onAudio({ type: "audio", index: i, audio });
      } catch {
        failed = true;
        options.onError();
      }
    });
  }

  return {
    push(delta: string) {
      const text = delta.slice(0, REPLY_SPEECH_MAX_CHARS - accepted);
      accepted += text.length;
      for (const sentence of splitter.push(text)) speak(sentence);
    },
    /** 最後の句点なしの文も読み上げ、費用記録用の送信文字数を返す */
    async finish() {
      const rest = splitter.flush();
      if (rest) speak(rest);
      await speech;
      return chars;
    },
  };
}
