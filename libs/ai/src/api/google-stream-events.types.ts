import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

declare namespace googleStreamEventsTypes {
  interface GoogleStreamState<T extends googleThinkingTypes.GoogleApiType> {
    readonly model: typesModule.Model<T>;
    readonly output: typesModule.AssistantMessage;
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    currentBlock: typesModule.TextContent | typesModule.ThinkingContent | null;
  }

  interface GoogleStreamFailure<T extends googleThinkingTypes.GoogleApiType> {
    readonly state: GoogleStreamState<T>;
    readonly error: unknown;
    readonly signal: AbortSignal | undefined;
  }
}

export type { googleStreamEventsTypes as default };
