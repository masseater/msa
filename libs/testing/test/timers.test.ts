import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vite-plus/test";

import testing from "../src/index.ts";

const { timersArmedBy } = testing;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const aForkedSleepIsHolding = Effect.gen(function* () {
  const [fiber, timers] = yield* timersArmedBy(
    Effect.gen(function* () {
      const forked = yield* Effect.forkDetach(Effect.sleep("1 minute"));
      yield* settle;
      return forked;
    }),
  );
  yield* Fiber.interrupt(fiber);
  expect(timers).toEqual({ armed: 1, holding: 1 });
});

const unrefAndClearedTimersAreNotHolding = Effect.gen(function* () {
  const [, timers] = yield* timersArmedBy(
    Effect.gen(function* () {
      AbortSignal.timeout(60_000);
      const sleeping = yield* Effect.forkDetach(Effect.sleep("1 minute"));
      yield* settle;
      yield* Fiber.interrupt(sleeping);
    }),
  );
  expect(timers).toEqual({ armed: 2, holding: 0 });
});

const timersArmedElsewhereMeanwhileAreNotCounted = Effect.gen(function* () {
  const elsewhereArmed = Promise.withResolvers<void>();
  const elsewhere = yield* Effect.yieldNow.pipe(
    Effect.andThen(Effect.sync(() => elsewhereArmed.resolve())),
    Effect.andThen(Effect.sleep("1 minute")),
    Effect.forkDetach,
  );
  const [, timers] = yield* timersArmedBy(
    Effect.promise(() => elsewhereArmed.promise).pipe(Effect.andThen(settle)),
  );
  yield* Fiber.interrupt(elsewhere);
  expect(timers).toEqual({ armed: 0, holding: 0 });
});

const interruptingTheCallerStopsTheRunAndItsTimers = Effect.gen(function* () {
  const seen = { childRanPastSleep: false, interrupted: false, ranPastSleep: false };
  const caller = yield* Effect.forkChild(
    timersArmedBy(
      Effect.gen(function* () {
        yield* Effect.forkChild(
          Effect.sleep("50 millis").pipe(
            Effect.andThen(
              Effect.sync(() => {
                seen.childRanPastSleep = true;
              }),
            ),
          ),
        );
        yield* Effect.sleep("50 millis");
        seen.ranPastSleep = true;
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            seen.interrupted = true;
          }),
        ),
      ),
    ),
  );
  yield* Effect.sleep("10 millis");
  yield* Fiber.interrupt(caller);
  expect(seen.interrupted).toBe(true);
  yield* Effect.sleep("100 millis");
  expect(seen).toEqual({ childRanPastSleep: false, interrupted: true, ranPastSleep: false });
});

describe("timersArmedBy", () => {
  it("counts a ref'd timer that a fiber the run forks keeps armed", () =>
    Effect.runPromise(aForkedSleepIsHolding));

  it("counts unref'd and cleared timers as armed but not holding", () =>
    Effect.runPromise(unrefAndClearedTimersAreNotHolding));

  it("ignores timers that something other than the run arms meanwhile", () =>
    Effect.runPromise(timersArmedElsewhereMeanwhileAreNotCounted));

  it("stops the run and clears the timers it armed when the caller is interrupted", () =>
    Effect.runPromise(interruptingTheCallerStopsTheRunAndItsTimers));
});
