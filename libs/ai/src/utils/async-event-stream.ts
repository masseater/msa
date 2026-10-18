import { Cause, Deferred, Effect, Exit, Queue } from "effect";

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
