import { Clock, Effect } from "effect";

import type typesModule from "../types.types.ts";
import eventStreamModule from "./event-stream.ts";
const finalMessage = (event: typesModule.AssistantMessageEvent): typesModule.AssistantMessage => {
  if (event.type === "done") return event.message;
  if (event.type === "error") return event.error;
  throw new Error("Unexpected event type for final result");
};

export default class AssistantMessageEventStream implements AsyncIterable<typesModule.AssistantMessageEvent> {
  readonly #channel = eventStreamModule.createEventChannel<
    typesModule.AssistantMessageEvent,
    typesModule.AssistantMessage
  >({
    extractResult: finalMessage,
    isComplete: (event) => event.type === "done" || event.type === "error",
  });
  readonly #startedAt = Effect.runSync(Clock.currentTimeMillis);
  readonly #startedAtMonotonic = performance.now();

  push(event: typesModule.AssistantMessageEvent): void {
    if (event.type === "done") this.#time(event.message);
    else if (event.type === "error") this.#time(event.error);
    this.#channel.push(event);
  }

  end(result?: typesModule.AssistantMessage): void {
    if (result !== undefined) this.#time(result);
    this.#channel.end(result);
  }

  [Symbol.asyncIterator](): AsyncIterator<typesModule.AssistantMessageEvent> {
    return this.#channel[Symbol.asyncIterator]();
  }

  result(): Promise<typesModule.AssistantMessage> {
    return this.#channel.result();
  }

  #time(message: typesModule.AssistantMessage): void {
    if (
      this.#channel.isDone() ||
      message.durationMs !== undefined ||
      message.timestamp < this.#startedAt
    ) {
      return;
    }
    message.durationMs = Math.max(0, Math.round(performance.now() - this.#startedAtMonotonic));
  }
}
