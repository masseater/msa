import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";

const { scheduleUnref } = platform;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const aPendingTimerLeavesTheProcessFreeToExit = Effect.gen(function* () {
  const before = timersHoldingTheProcess();
  const timer = scheduleUnref(() => undefined, 60_000);
  yield* settle;
  const pending = timersHoldingTheProcess();
  timer.cancel();
  expect(pending).toBe(before);
});

const theTimerRunsUnlessCancelled = Effect.gen(function* () {
  const fired: string[] = [];
  scheduleUnref(() => fired.push("kept"), 5);
  scheduleUnref(() => fired.push("cancelled"), 5).cancel();
  yield* Effect.callback<void>((resume) => {
    const done = scheduleUnref(() => {
      resume(Effect.void);
    }, 40);
    return Effect.sync(done.cancel);
  });
  expect(fired).toEqual(["kept"]);
});

describe("scheduleUnref", () => {
  it("leaves the process free to exit while the timer is pending", () =>
    Effect.runPromise(aPendingTimerLeavesTheProcessFreeToExit));

  it("runs the callback unless it was cancelled", () =>
    Effect.runPromise(theTimerRunsUnlessCancelled));
});
