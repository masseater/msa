import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import exec from "../src/core/exec.ts";
import cacheWarmerSupport from "./cache-warmer-support.ts";

const { execCommand } = exec;
const { current, fakeRuntime, request } = cacheWarmerSupport;
const { abortController, runTest } = testing;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

const cacheWarmerLeavesTheProcessFree = Effect.gen(function* () {
  const { warmer } = fakeRuntime();
  const before = timersHoldingTheProcess();
  warmer.start(request(), current);
  yield* settle;
  const status = warmer.status;
  const pending = timersHoldingTheProcess();
  warmer.cancel();
  expect(status.state).toBe("scheduled");
  expect(pending).toBe(before);
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
  const before = timersHoldingTheProcess();
  controller.abort();
  yield* settle;
  const pending = timersHoldingTheProcess();
  const stillRunning = !settled;
  const finished = yield* Effect.promise(() => result);
  expect(stillRunning).toBe(true);
  expect(finished.killed).toBe(true);
  expect(pending).toBe(before);
});

describe("background coding-agent timers leave the process free to exit", () => {
  it("while the cache warmer waits for its next refresh", () =>
    runTest(cacheWarmerLeavesTheProcessFree));

  it.skipIf(process.platform === "win32")(
    "while an aborted command that ignores SIGTERM waits for its SIGKILL fallback",
    () => runTest(killFallbackLeavesTheProcessFree),
  );
});
