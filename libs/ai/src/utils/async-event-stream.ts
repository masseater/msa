import eventStream from "./event-stream.ts";
import type eventStreamTypes from "./event-stream.types.ts";

const { createEventChannel } = eventStream;

export default class EventStream<T, R = T> implements AsyncIterable<T> {
  readonly #channel: eventStreamTypes.EventChannel<T, R>;

  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
    this.#channel = createEventChannel({ extractResult, isComplete });
  }

  push(event: T): void {
    this.#channel.push(event);
  }

  end(result?: R): void {
    this.#channel.end(result);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.#channel[Symbol.asyncIterator]();
  }

  result(): Promise<R> {
    return this.#channel.result();
  }
}
