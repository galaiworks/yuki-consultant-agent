import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // エージェントは実行時に .claude/skills/*/SKILL.md を読むため、関数のバンドルに含める
  outputFileTracingIncludes: {
    "/api/**/*": ["./.claude/skills/**/*"],
  },
};

export default nextConfig;
