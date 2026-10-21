import type Anthropic from "@anthropic-ai/sdk";

import type typesModule from "../types.types.ts";
import type anthropicMessagesCompatTypes from "./anthropic-messages-compat.types.ts";

declare namespace anthropicMessagesOptionsTypes {
  interface AnthropicOptions extends typesModule.StreamOptions {
    thinkingEnabled?: boolean | undefined;
    thinkingBudgetTokens?: number | undefined;
    effort?: anthropicMessagesCompatTypes.AnthropicEffort | undefined;
    thinkingDisplay?: anthropicMessagesCompatTypes.AnthropicThinkingDisplay | undefined;
    interleavedThinking?: boolean | undefined;
    toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string } | undefined;
    client?: Anthropic | undefined;
  }
}

export type { anthropicMessagesOptionsTypes as default };
