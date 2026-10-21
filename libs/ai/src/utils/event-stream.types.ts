import type eventStream from "./event-stream.ts";

declare namespace eventStreamTypes {
  interface EventChannelOptions<T, R> {
    readonly isComplete: (event: T) => boolean;
    readonly extractResult: (event: T) => R;
  }

  interface EventChannel<T, R> extends AsyncIterable<T> {
    readonly isDone: () => boolean;
    readonly push: (event: T) => void;
    readonly end: (result?: R) => void;
    readonly result: () => Promise<R>;
  }

  type AssistantMessageEventStream = (typeof eventStream.AssistantMessageEventStream)["prototype"];
}

export type { eventStreamTypes as default };
