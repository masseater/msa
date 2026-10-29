import testing from "@msa/testing";
import { Deferred, Effect } from "effect";
import { dual } from "effect/Function";

import type timingTypes from "./timing.types.ts";

const tick: Effect.Effect<void> = Effect.callback<void>((resume) => {
  setImmediate(() => resume(Effect.void));
});

const ticks = (count = 10): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let index = 0; index < count; index++) yield* tick;
  });

const pollUntil: {
  (attempts: number, step: Effect.Effect<void>): (check: () => boolean) => Effect.Effect<void>;
  (check: () => boolean, attempts: number, step: Effect.Effect<void>): Effect.Effect<void>;
} = dual(
  3,
  (check: () => boolean, attempts: number, step: Effect.Effect<void>): Effect.Effect<void> =>
    testing.pollUntil(Effect.sync(check), attempts, step),
);

const latch = <T = void>(): timingTypes.Latch<T> => {
  const deferred = Deferred.makeUnsafe<T>();
  return {
    open: (value) => {
      Deferred.doneUnsafe(deferred, Effect.succeed(value));
    },
    promise: Effect.runPromise(Deferred.await(deferred)),
    wait: Deferred.await(deferred),
  };
};

const abortOf = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    signal.addEventListener("abort", () => resume(Effect.void));
  });

const timing = {
  abortOf,
  latch,
  pollUntil,
  tick,
  ticks,
};

export default timing;
