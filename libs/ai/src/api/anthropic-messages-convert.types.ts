import type {
  BetaTool,
  BetaCacheControlEphemeral as CacheControlEphemeral,
  BetaMessageParam as MessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import type anthropicMessagesCompatTypes from "./anthropic-messages-compat.types.ts";

declare namespace anthropicMessagesConvertTypes {
  interface InsertThinkingLevelMessagesInput {
    readonly converted: ConvertedAnthropicMessages;
    readonly activeEffort: anthropicMessagesCompatTypes.AnthropicEffort;
  }

  type ToolDefinitionsConverter = (tools: typesModule.Tool[]) => BetaTool[];

  interface ConvertedAnthropicMessages {
    messages: MessageParam[];
    assistantLevels: Map<number, anthropicMessagesCompatTypes.AnthropicEffort>;
  }

  interface ConvertMessagesOptions {
    cacheControl?: CacheControlEphemeral | undefined;
    allowEmptySignature?: boolean | undefined;
    managedProvider?: string | undefined;
    convertToolDefinitions?: ToolDefinitionsConverter | undefined;
  }

  interface ConvertMessagesInput extends ConvertMessagesOptions {
    readonly messages: typesModule.Message[];
  }
}

export type { anthropicMessagesConvertTypes as default };
