import { Cause, Clock, Deferred, Effect, Exit, Queue } from "effect";

import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";

export class EventStream<T, R = T> implements AsyncIterable<T> {
  protected done = false;
  private readonly queue: Queue.Queue<T, Cause.Done>;
  private readonly finalResult = Deferred.makeUnsafe<R>();
  private finalResultPromise: Promise<R> | undefined;
  private readonly isComplete: (event: T) => boolean;
  private readonly extractResult: (event: T) => R;

  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.queue = Effect.runSync(Queue.unbounded<T, Cause.Done>());
  }

  push(event: T): void {
    if (this.done) return;

    const complete = this.isComplete(event);
    if (complete) {
      this.done = true;
      Deferred.doneUnsafe(this.finalResult, Exit.succeed(this.extractResult(event)));
    }
    Queue.offerUnsafe(this.queue, event);
    if (complete) Queue.endUnsafe(this.queue);
  }

  end(result?: R): void {
    this.done = true;
    if (result !== undefined) {
      Deferred.doneUnsafe(this.finalResult, Exit.succeed(result));
    }
    Queue.endUnsafe(this.queue);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const { queue } = this;
    return {
      next: () =>
        Effect.runPromise(
          Queue.take(queue).pipe(
            Effect.map((value): IteratorResult<T> => ({ value, done: false })),
            Effect.catchIf(Cause.isDone, () =>
              Effect.succeed<IteratorResult<T>>({ value: undefined, done: true }),
            ),
          ),
        ),
    };
  }

  result(): Promise<R> {
    this.finalResultPromise ??= Effect.runPromise(Deferred.await(this.finalResult));
    return this.finalResultPromise;
  }
}

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
