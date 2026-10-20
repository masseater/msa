import type aiTypes from "@msa/ai/index.types";

declare namespace eventsStreamTypes {
  type Generations = {
    readonly partialBefore: aiTypes.AssistantMessage | undefined;
    readonly partial: aiTypes.AssistantMessage | undefined;
  };
}

export type { eventsStreamTypes as default };
