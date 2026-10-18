import { Cause, Clock, Deferred, Effect, Exit, Queue } from "effect";

import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";

export interface EventChannelOptions<T, R> {
  readonly isComplete: (event: T) => boolean;
  readonly extractResult: (event: T) => R;
}

export interface EventChannel<T, R> extends AsyncIterable<T> {
  readonly isDone: () => boolean;
  readonly push: (event: T) => void;
  readonly end: (result?: R) => void;
  readonly result: () => Promise<R>;
}

const takeNext = <T>(queue: Queue.Queue<T, Cause.Done>): Promise<IteratorResult<T>> =>
  Effect.runPromise(
    Queue.take(queue).pipe(
      Effect.map((value): IteratorResult<T> => ({ value, done: false })),
      Effect.catchIf(Cause.isDone, () =>
        Effect.succeed<IteratorResult<T>>({ value: undefined, done: true }),
      ),
    ),
  );

export function createEventChannel<T, R>({
  isComplete,
  extractResult,
}: EventChannelOptions<T, R>): EventChannel<T, R> {
  const queue = Effect.runSync(Queue.unbounded<T, Cause.Done>());
  const finalResult = Deferred.makeUnsafe<R>();
  let done = false;
  let finalResultPromise: Promise<R> | undefined;
  return {
    isDone: () => done,
    push: (event) => {
      if (done) return;
      const complete = isComplete(event);
      if (complete) {
        done = true;
        Deferred.doneUnsafe(finalResult, Exit.succeed(extractResult(event)));
      }
      Queue.offerUnsafe(queue, event);
      if (complete) Queue.endUnsafe(queue);
    },
    end: (result) => {
      done = true;
      if (result !== undefined) Deferred.doneUnsafe(finalResult, Exit.succeed(result));
      Queue.endUnsafe(queue);
    },
    result: () => {
      finalResultPromise ??= Effect.runPromise(Deferred.await(finalResult));
      return finalResultPromise;
    },
    [Symbol.asyncIterator]: () => ({ next: () => takeNext(queue) }),
  };
}

const finalMessage = (event: AssistantMessageEvent): AssistantMessage => {
  if (event.type === "done") return event.message;
  if (event.type === "error") return event.error;
  throw new Error("Unexpected event type for final result");
};

export class AssistantMessageEventStream implements AsyncIterable<AssistantMessageEvent> {
  readonly #channel = createEventChannel<AssistantMessageEvent, AssistantMessage>({
    isComplete: (event) => event.type === "done" || event.type === "error",
    extractResult: finalMessage,
  });
  readonly #startedAt = Effect.runSync(Clock.currentTimeMillis);
  readonly #startedAtMonotonic = performance.now();

  push(event: AssistantMessageEvent): void {
    if (event.type === "done") this.#time(event.message);
    else if (event.type === "error") this.#time(event.error);
    this.#channel.push(event);
  }

  end(result?: AssistantMessage): void {
    if (result !== undefined) this.#time(result);
    this.#channel.end(result);
  }

  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    return this.#channel[Symbol.asyncIterator]();
  }

  result(): Promise<AssistantMessage> {
    return this.#channel.result();
  }

  #time(message: AssistantMessage): void {
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

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
  return new AssistantMessageEventStream();
}
