import assert from "node:assert/strict";

import { Deferred, Effect } from "effect";

export const tick: Effect.Effect<void> = Effect.callback<void>((resume) => {
  setImmediate(() => resume(Effect.void));
});

export const ticks = (count = 10): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let index = 0; index < count; index++) yield* tick;
  });

export const pollUntil = (
  check: () => boolean,
  attempts: number,
  step: Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < attempts && !check(); attempt++) yield* step;
    assert.ok(check(), "condition not reached");
  });

export interface Latch<T = void> {
  readonly promise: Promise<T>;
  readonly wait: Effect.Effect<T>;
  readonly open: (value: T) => void;
}

export const latch = <T = void>(): Latch<T> => {
  const deferred = Deferred.makeUnsafe<T>();
  return {
    promise: Effect.runPromise(Deferred.await(deferred)),
    wait: Deferred.await(deferred),
    open: (value) => {
      Deferred.doneUnsafe(deferred, Effect.succeed(value));
    },
  };
};
