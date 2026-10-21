import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vite-plus/test";

import daemonProcess from "../src/daemon-process.ts";

const { launchDaemon } = daemonProcess;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const pingLoopLeavesTheProcessFree = Effect.gen(function* () {
  const before = timersHoldingTheProcess();
  const { session } = yield* launchDaemon({
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
  const pending = timersHoldingTheProcess();
  yield* Scope.close(session.scope, Exit.void);
  expect(pending).toBe(before);
});

describe.skipIf(process.platform === "win32")("daemon session", () => {
  it("leaves the process free to exit while its ping loop waits", () =>
    Effect.runPromise(pingLoopLeavesTheProcessFree));
});
