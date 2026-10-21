import type Anthropic from "@anthropic-ai/sdk";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";

declare namespace anthropicMessagesRunTypes {
  interface RunState {
    readonly model: typesModule.Model<"anthropic-messages">;
    readonly output: typesModule.AssistantMessage;
    readonly options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    readonly client: Anthropic;
  }
}

export type { anthropicMessagesRunTypes as default };
