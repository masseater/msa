import { Cause, Deferred, Effect, Exit, Queue } from "effect";

import AssistantMessageEventStream from "./assistant-message-event-stream.ts";
import type eventStreamTypes from "./event-stream.types.ts";

const takeNext = <T>(queue: Queue.Queue<T, Cause.Done>): Promise<IteratorResult<T>> =>
  Effect.runPromise(
    Queue.take(queue).pipe(
      Effect.map((value): IteratorResult<T> => ({ done: false, value })),
      Effect.catchIf(Cause.isDone, () =>
        Effect.succeed<IteratorResult<T>>({ done: true, value: undefined }),
      ),
    ),
  );

function createEventChannel<T, R>({
  isComplete,
  extractResult,
}: eventStreamTypes.EventChannelOptions<T, R>): eventStreamTypes.EventChannel<T, R> {
  const queue = Effect.runSync(Queue.unbounded<T, Cause.Done>());
  const finalResult = Deferred.makeUnsafe<R>();
  let done = false;
  let finalResultPromise: Promise<R> | undefined;
  return {
    end: (result) => {
      done = true;
      if (result !== undefined) Deferred.doneUnsafe(finalResult, Exit.succeed(result));
      Queue.endUnsafe(queue);
    },
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
    result: () => {
      finalResultPromise ??= Effect.runPromise(Deferred.await(finalResult));
      return finalResultPromise;
    },
    [Symbol.asyncIterator]: () => ({ next: () => takeNext(queue) }),
  };
}

function createAssistantMessageEventStream(): AssistantMessageEventStream {
  return new AssistantMessageEventStream();
}

const eventStream = {
  AssistantMessageEventStream,
  createAssistantMessageEventStream,
  createEventChannel,
};

export default eventStream;
