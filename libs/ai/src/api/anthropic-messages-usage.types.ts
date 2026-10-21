import type { BetaInputTransformation } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";

declare namespace anthropicMessagesUsageTypes {
  interface UsageState {
    readonly output: typesModule.AssistantMessage;
    usageModel: typesModule.Model<"anthropic-messages">;
    inputTransformations: BetaInputTransformation[] | undefined;
  }
}

export type { anthropicMessagesUsageTypes as default };
