import type Anthropic from "@anthropic-ai/sdk";

import type { StreamOptions } from "../types.ts";
import type { AnthropicEffort, AnthropicThinkingDisplay } from "./anthropic-messages-compat.ts";

export interface AnthropicOptions extends StreamOptions {
  thinkingEnabled?: boolean | undefined;
  thinkingBudgetTokens?: number | undefined;
  effort?: AnthropicEffort | undefined;
  thinkingDisplay?: AnthropicThinkingDisplay | undefined;
  interleavedThinking?: boolean | undefined;
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string } | undefined;
  client?: Anthropic | undefined;
}
