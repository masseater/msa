import type { AssistantMessage } from "@msa/ai";

declare namespace eventsStreamTypes {
  type Generations = {
    readonly partialBefore: AssistantMessage | undefined;
    readonly partial: AssistantMessage | undefined;
  };
}

export type { eventsStreamTypes as default };
