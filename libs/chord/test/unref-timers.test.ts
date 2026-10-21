import { Effect, Exit, Fiber, Scope } from "effect";
import { describe, expect, it } from "vite-plus/test";

import HostTimers from "../src/timers.ts";
import unrefSleepModule from "../src/unref-sleep.ts";

const { unrefSleep } = unrefSleepModule;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const pendingTimersLeaveTheProcessFreeToExit = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const timers = new HostTimers(scope);
  const before = timersHoldingTheProcess();
  const stopAfter = timers.after(60_000, () => undefined);
  const stopEvery = timers.every(60_000, () => undefined);
  const sleeping = yield* Effect.forkDetach(unrefSleep(60_000));
  yield* settle;
  const pending = timersHoldingTheProcess();
  stopAfter();
  stopEvery();
  yield* Scope.close(scope, Exit.void);
  yield* Fiber.interrupt(sleeping);
  expect(pending).toBe(before);
});

const timersStillFire = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const timers = new HostTimers(scope);
  const fired: string[] = [];
  timers.after(5, () => fired.push("after"));
  const stopEvery = timers.every(5, () => fired.push("every"));
  yield* unrefSleep(40);
  stopEvery();
  yield* Scope.close(scope, Exit.void);
  expect(fired).toContain("after");
  expect(fired.filter((name) => name === "every").length).toBeGreaterThan(1);
});

describe("host timers", () => {
  it("leave the process free to exit while they are pending", () =>
    Effect.runPromise(pendingTimersLeaveTheProcessFreeToExit));

  it("still fire once and on every interval", () => Effect.runPromise(timersStillFire));
});
