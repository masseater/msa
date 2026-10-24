import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import exec from "../src/core/exec.ts";
import cacheWarmerSupport from "./cache-warmer-support.ts";

const { execCommand } = exec;
const { current, fakeRuntime, request } = cacheWarmerSupport;
const { abortController, runTest, timersArmedBy } = testing;

const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

const cacheWarmerLeavesTheProcessFree = Effect.gen(function* () {
  const { warmer } = fakeRuntime();
  const [status, timers] = yield* timersArmedBy(
    Effect.gen(function* () {
      warmer.start(request(), current);
      yield* settle;
      return warmer.status;
    }),
  );
  warmer.cancel();
  expect(status.state).toBe("scheduled");
  expect(timers.armed).toBeGreaterThan(0);
  expect(timers.holding).toBe(0);
});

const killFallbackLeavesTheProcessFree = Effect.gen(function* () {
  const controller = abortController();
  let settled = false;
  const result = execCommand("sh", ["-c", "trap '' TERM; sleep 1"], process.cwd(), {
    signal: controller.signal,
  }).finally(() => {
    settled = true;
  });
  yield* Effect.sleep(200);
  yield* settle;
  const [stillRunning, timers] = yield* timersArmedBy(
    Effect.sync(() => {
      controller.abort();
      return !settled;
    }),
  );
  const finished = yield* Effect.promise(() => result);
  expect(stillRunning).toBe(true);
  expect(finished.killed).toBe(true);
  expect(timers.armed).toBeGreaterThan(0);
  expect(timers.holding).toBe(0);
});

describe("background coding-agent timers leave the process free to exit", () => {
  it("while the cache warmer waits for its next refresh", () =>
    runTest(cacheWarmerLeavesTheProcessFree));

  it.skipIf(process.platform === "win32")(
    "while an aborted command that ignores SIGTERM waits for its SIGKILL fallback",
    () => runTest(killFallbackLeavesTheProcessFree),
  );
});
