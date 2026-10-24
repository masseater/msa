import testing from "@msa/testing";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vite-plus/test";

import daemonProcess from "../src/daemon-process.ts";

const { launchDaemon } = daemonProcess;
const { timersArmedBy } = testing;

const launchAndLetThePingLoopWait = Effect.gen(function* () {
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
  yield* Effect.repeat(Effect.yieldNow, { times: 3 });
  return launched.session;
});

const pingLoopLeavesTheProcessFree = Effect.gen(function* () {
  const [session, timers] = yield* timersArmedBy(launchAndLetThePingLoopWait);
  yield* Scope.close(session.scope, Exit.void);
  expect(timers.armed).toBeGreaterThan(0);
  expect(timers.holding).toBe(0);
});

describe.skipIf(process.platform === "win32")("daemon session", () => {
  it("leaves the process free to exit while its ping loop waits", () =>
    Effect.runPromise(pingLoopLeavesTheProcessFree));
});
