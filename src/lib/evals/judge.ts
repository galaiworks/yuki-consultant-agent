import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODELS } from "@/lib/config";
import { anthropic } from "@/lib/agents/client";
import type { UsageSink } from "@/lib/agents/types";
import type { GradeResult } from "@/lib/evals/cases";

const VerdictSchema = z.object({
  passed: z.boolean().describe("基準を満たしていれば true"),
  reason: z.string().describe("判定の理由を日本語で 1〜2 文。どこが足りないかを具体的に"),
});

/** 採点基準(英語でも日本語でもよい)に照らして、回答が合格かを判定する */
export async function judge(
  name: string,
  criteria: string,
  prompt: string,
  reply: string,
  usage: UsageSink,
): Promise<GradeResult> {
  const res = await anthropic().messages.parse({
    model: MODELS.guardian,
    max_tokens: 2000,
    output_config: { effort: "medium", format: zodOutputFormat(VerdictSchema) },
    system:
      "あなたは採点者です。YUKI AI(YUKI 本人公認の AI。相談者に YUKI として一人称で答える)の回答を、与えられた基準だけで厳密に採点します。基準にない点で減点しません。",
    messages: [
      {
        role: "user",
        content: `# 採点基準\n${criteria}\n\n# 相談\n${prompt}\n\n# 回答\n${reply}`,
      },
    ],
  });
  await usage("eval_judge", MODELS.guardian, res.usage);
  const v = res.parsed_output;
  if (!v) return { name, passed: false, reason: "採点結果を読み取れませんでした" };
  return { name, passed: v.passed, reason: v.reason };
}
