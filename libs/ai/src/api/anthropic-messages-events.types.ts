import type { BetaInputTransformation } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";

declare namespace anthropicMessagesEventsTypes {
  interface StreamState {
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    readonly model: typesModule.Model<"anthropic-messages">;
    readonly output: typesModule.AssistantMessage;
    usageModel: typesModule.Model<"anthropic-messages">;
    inputTransformations: BetaInputTransformation[] | undefined;
  }
}

export type { anthropicMessagesEventsTypes as default };
