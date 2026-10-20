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

  type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

  type AnthropicThinkingDisplay = "summarized" | "omitted";
}

export type { anthropicMessagesCompatTypes as default };
