/**
 * アプリ全体の設定。環境変数はここ以外から直接読まない。
 */

export const MODELS = {
  /** 司令塔と Guardian(判断の質が最重要) */
  lead: "claude-opus-5-5",
  guardian: "claude-opus-5-5",
  /** 専門エージェント */
  worker: "claude-sonnet-5-5",
  /** 分類・要約など軽い処理 */
  light: "claude-haiku-5-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * YUKI の声(ElevenLabs)。2026-11-05 に聞き比べて決めた設定(サンプル H)。
 * 声の ID は ELEVENLABS_VOICE_ID、キーは ELEVENLABS_API_KEY(どちらもサーバーだけ)。
 * 文は漢字まじりのまま渡す(ひらがなだけにするとアクセントが崩れる)。読み間違える語だけ読みを直す。
 */
export const VOICE = {
  model: "eleven_v4",
  sttModel: "scribe_v2",
  languageCode: "ja",
  settings: { stability: 0.5, similarity_boost: 0.9, style: 0, use_speaker_boost: true },
  outputFormat: "mp3_44100_128",
} as const;

/** open = 招待済みなら無料で利用 / paid = サブスクかチケットが必要 */
export type AccessMode = "open" | "paid";

function readAccessMode(): AccessMode {
  const v = process.env.ACCESS_MODE ?? "open";
  if (v !== "open" && v !== "paid") {
    throw new Error(`ACCESS_MODE は open か paid です(現在: ${v})`);
  }
  return v;
}

export const appConfig = {
  get accessMode(): AccessMode {
    return readAccessMode();
  },
  get defaultPlanId(): string {
    return process.env.DEFAULT_PLAN_ID ?? "founding";
  },
  get deliverableHumanReview(): boolean {
    return process.env.DELIVERABLE_HUMAN_REVIEW === "true";
  },
  get siteUrl(): string {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  },
  /** 環境変数 ADMIN_EMAILS(カンマ区切り)に書いたメールアドレスは管理者として扱う */
  get adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get stripeEnabled(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  },
  /** 音声会話(ElevenLabs の文字起こしと読み上げ)。キーはサーバーだけで使う */
  get voiceEnabled(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
  },
  get elevenLabsVoiceId(): string {
    return requireEnv("ELEVENLABS_VOICE_ID");
  },
  get elevenLabsApiKey(): string {
    return requireEnv("ELEVENLABS_API_KEY");
  },
};

/** 必須の環境変数を読む。未設定なら分かりやすく落とす */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
}
