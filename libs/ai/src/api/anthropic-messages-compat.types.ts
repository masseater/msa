import type { BetaOutputConfig } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
declare namespace anthropicMessagesCompatTypes {
  interface CacheRetentionInput {
    readonly cacheRetention?: typesModule.CacheRetention | undefined;
    readonly env?: typesModule.ProviderEnv | undefined;
  }

  interface CacheControlInput extends CacheRetentionInput {
    readonly model: typesModule.Model<"anthropic-messages">;
  }

  interface ThinkingLevelInput {
    readonly model: typesModule.Model<"anthropic-messages">;
    readonly level: typesModule.SimpleStreamOptions["reasoning"];
  }

  type AnthropicEffort = NonNullable<BetaOutputConfig["effort"]>;

  type AnthropicThinkingDisplay = "summarized" | "omitted";
}

export type { anthropicMessagesCompatTypes as default };
