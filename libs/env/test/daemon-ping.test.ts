import { AsyncResource, createHook } from "node:async_hooks";

import { Effect, Exit, Fiber, Scope } from "effect";
import { describe, expect, it } from "vite-plus/test";

import daemonProcess from "../src/daemon-process.ts";

const { launchDaemon } = daemonProcess;

type Timer = { readonly hasRef: () => boolean };

const timersHoldingTheProcessArmedBy = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<readonly [A, { readonly all: number; readonly armedByTheRun: number }], E> =>
  Effect.gen(function* () {
    const root = new AsyncResource("TimersHoldingTheProcess");
    const lineage = new Set([root.asyncId()]);
    const armed = new Map<number, { readonly byTheRun: boolean; readonly timer: Timer }>();
    const hook = createHook({
      destroy: (id) => {
        armed.delete(id);
      },
      init: (id, type, trigger, resource) => {
        const byTheRun = lineage.has(trigger);
        if (byTheRun) lineage.add(id);
        if (type === "Timeout") armed.set(id, { byTheRun, timer: resource as Timer });
      },
    });
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => hook.enable()),
      () =>
        Effect.promise(() => root.runInAsyncScope(() => Effect.runPromiseExit(effect))).pipe(
          Effect.flatMap((exit) => exit),
          Effect.map((value) => {
            const holding = [...armed.values()].filter(({ timer }) => timer.hasRef());
            const armedByTheRun = holding.filter(({ byTheRun }) => byTheRun).length;
            return [value, { all: holding.length, armedByTheRun }] as const;
          }),
        ),
      () =>
        Effect.sync(() => {
          hook.disable();
          root.emitDestroy();
        }),
    );
  });

const launchAndLetThePingLoopWait = (meanwhile: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const launched = yield* launchDaemon({
      args: ["-c", "exec sleep 30"],
      id: 1,
      onData: () => {},
      onLog: () => {},
      onLost: () => {},
      onTick: () => {},
      program: "sh",
      startedAt: 0,
    });
    yield* meanwhile;
    yield* Effect.repeat(Effect.yieldNow, { times: 3 });
    return launched.session;
  });

const pingLoopLeavesTheProcessFree = Effect.gen(function* () {
  const [session, holding] = yield* Effect.void.pipe(
    launchAndLetThePingLoopWait,
    timersHoldingTheProcessArmedBy,
  );
  yield* Scope.close(session.scope, Exit.void);
  expect(holding.armedByTheRun).toBe(0);
});

const unrelatedTimersAreNotCounted = Effect.gen(function* () {
  const unrelatedArmed = Promise.withResolvers<void>();
  const unrelated = yield* Effect.sleep(0).pipe(
    Effect.andThen(Effect.sync(() => unrelatedArmed.resolve())),
    Effect.andThen(Effect.sleep("1 minute")),
    Effect.forkDetach,
  );
  const [session, holding] = yield* Effect.promise(() => unrelatedArmed.promise).pipe(
    launchAndLetThePingLoopWait,
    timersHoldingTheProcessArmedBy,
  );
  yield* Scope.close(session.scope, Exit.void);
  yield* Fiber.interrupt(unrelated);
  expect(holding.all).toBeGreaterThan(0);
  expect(holding.armedByTheRun).toBe(0);
});

const forkedSleepIsCounted = Effect.gen(function* () {
  const [fiber, holding] = yield* timersHoldingTheProcessArmedBy(
    Effect.gen(function* () {
      const forked = yield* Effect.forkDetach(Effect.sleep("1 minute"));
      yield* Effect.repeat(Effect.yieldNow, { times: 3 });
      return forked;
    }),
  );
  yield* Fiber.interrupt(fiber);
  expect(holding.armedByTheRun).toBe(1);
});

describe.skipIf(process.platform === "win32")("daemon session", () => {
  it("leaves the process free to exit while its ping loop waits", () =>
    Effect.runPromise(pingLoopLeavesTheProcessFree));

  it("ignores ref'd timers that something other than the daemon arms meanwhile", () =>
    Effect.runPromise(unrelatedTimersAreNotCounted));

  it("counts a ref'd timer that a fiber the run forks keeps armed", () =>
    Effect.runPromise(forkedSleepIsCounted));
});
