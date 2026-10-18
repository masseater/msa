import { createEventChannel, type EventChannel } from "./event-stream.ts";

export class EventStream<T, R = T> implements AsyncIterable<T> {
  readonly #channel: EventChannel<T, R>;

  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
    this.#channel = createEventChannel({ isComplete, extractResult });
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
