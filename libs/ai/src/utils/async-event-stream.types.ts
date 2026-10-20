import type EventStreamClass from "./async-event-stream.ts";

declare namespace asyncEventStreamTypes {
  type EventStream<T, R = T> = EventStreamClass<T, R>;
}

export type { asyncEventStreamTypes as default };
