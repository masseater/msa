import type compatTypes from "@msa/ai/compat.types";

declare namespace configTypes {
  type Backend = "anthropic" | "openai";

  interface GitLabModel {
    id: string;
    name: string;
    backend: Backend;
    baseUrl: string;
    reasoning: boolean;
    thinkingLevelMap?: compatTypes.ThinkingLevelMap;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }

  interface DirectAccessToken {
    token: string;
    headers: Record<string, string>;
    expiresAt: number;
  }
}

export type { configTypes as default };
