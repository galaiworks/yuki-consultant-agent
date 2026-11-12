import { appConfig, VOICE } from "@/lib/config";

/**
 * ElevenLabs の文字起こし(相談者の声 → 文字)と読み上げ(YUKI の返事 → 声)。
 * キーはサーバーだけで使う。
 */
const API = "https://api.elevenlabs.io/v1";

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("model_id", VOICE.sttModel);
  form.append("language_code", "jpn");
  form.append("tag_audio_events", "false");
  form.append("file", audio, filename);
  const res = await fetch(`${API}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": appConfig.elevenLabsApiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`文字起こしに失敗しました (${res.status}) ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/**
 * 文字を YUKI の声にする。previousText(直前に話した文)を渡すと、
 * 文ごとに分けて作っても前後のつながりが自然な抑揚になる。
 * 届き始めが速い stream 版の窓口を使う。
 */
export async function synthesize(text: string, opts: { previousText?: string } = {}): Promise<ArrayBuffer> {
  const res = await fetch(
    `${API}/text-to-speech/${encodeURIComponent(appConfig.elevenLabsVoiceId)}/stream?output_format=${VOICE.outputFormat}`,
    {
      method: "POST",
      headers: { "xi-api-key": appConfig.elevenLabsApiKey, "content-type": "application/json" },
      body: JSON.stringify({
        model_id: VOICE.model,
        language_code: VOICE.languageCode,
        text,
        ...(opts.previousText ? { previous_text: opts.previousText.slice(-500) } : {}),
        voice_settings: VOICE.settings,
      }),
    },
  );
  if (!res.ok) throw new Error(`読み上げに失敗しました (${res.status}) ${await res.text().catch(() => "")}`);
  return res.arrayBuffer();
}

/**
 * 読み上げ用に文字を整える(テスト対象)。
 * 見出し記号・箇条書き・URL・Markdown の飾りは声にすると不自然なので外す。
 */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*・]|\d+[.)])\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
