import type { UsageLike } from "@/lib/usage";

/** 各エージェントが API 利用量を報告する先 */
export type UsageSink = (agent: string, model: string, usage: UsageLike) => Promise<void>;
