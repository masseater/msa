import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vite-plus/test";

import sleep from "../src/sleep.ts";

const { MAX_TIMER_MS, unrefSleep } = sleep;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const stillWaitingAfter = (millis: number, settleMs: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const waiting = yield* Effect.forkDetach(unrefSleep(millis));
    yield* unrefSleep(settleMs);
    const pending = waiting.pollUnsafe() === undefined;
    yield* Fiber.interrupt(waiting);
    return pending;
  });

const aPendingWaitLeavesTheProcessFree = Effect.gen(function* () {
  const before = timersHoldingTheProcess();
  const waiting = yield* Effect.forkDetach(unrefSleep(60_000));
  yield* settle;
  const pending = timersHoldingTheProcess();
  yield* Fiber.interrupt(waiting);
  expect(pending).toBe(before);
});

const waitsBeyondTheTimerLimit = Effect.gen(function* () {
  expect(yield* stillWaitingAfter(MAX_TIMER_MS + 1000, 50)).toBe(true);
  expect(yield* stillWaitingAfter(Number.POSITIVE_INFINITY, 50)).toBe(true);
});

const shortWaitsEnd = Effect.gen(function* () {
  yield* unrefSleep(5);
  yield* unrefSleep(-1);
  yield* unrefSleep(Number.NaN);
  expect(yield* stillWaitingAfter(1, 30)).toBe(false);
});

describe("unrefSleep", () => {
  it("leaves the process free to exit while it waits", () =>
    Effect.runPromise(aPendingWaitLeavesTheProcessFree));

  it("keeps waiting past the 2^31 - 1 ms timer limit instead of firing early", () =>
    Effect.runPromise(waitsBeyondTheTimerLimit));

  it("ends short, negative, and NaN waits", () => Effect.runPromise(shortWaitsEnd));
});
