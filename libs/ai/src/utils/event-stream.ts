import { Clock, Effect } from "effect";

import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";
import { EventStream } from "./async-event-stream.ts";

const finalMessage = (event: AssistantMessageEvent): AssistantMessage => {
  if (event.type === "done") return event.message;
  if (event.type === "error") return event.error;
  throw new Error("Unexpected event type for final result");
};

export class AssistantMessageEventStream extends EventStream<
  AssistantMessageEvent,
  AssistantMessage
> {
  readonly #startedAt = Effect.runSync(Clock.currentTimeMillis);
  readonly #startedAtMonotonic = performance.now();

  constructor() {
    super((event) => event.type === "done" || event.type === "error", finalMessage);
  }

  override push(event: AssistantMessageEvent): void {
    if (event.type === "done") this.#time(event.message);
    else if (event.type === "error") this.#time(event.error);
    super.push(event);
  }

  override end(result?: AssistantMessage): void {
    if (result !== undefined) this.#time(result);
    super.end(result);
  }

  #time(message: AssistantMessage): void {
    if (this.done || message.durationMs !== undefined || message.timestamp < this.#startedAt)
      return;
    message.durationMs = Math.max(0, Math.round(performance.now() - this.#startedAtMonotonic));
  }
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
  return new AssistantMessageEventStream();
}
