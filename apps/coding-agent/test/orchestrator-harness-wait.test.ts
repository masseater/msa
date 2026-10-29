import { Cause, Effect, Exit } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import exec from "../src/core/exec.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";
import providerWaitSupport from "./provider-wait-support.ts";

const { execCommand } = exec;
const { waitFor } = orchestratorHarness.harness;
const { fakeClock } = watchdogSupport;
const { settledUntil } = providerWaitSupport;

afterEach(() => {
  vi.useRealTimers();
});

const slowChild = () => {
  const state = { done: false };
  void execCommand("sleep", ["0.3"], ".").finally(() => {
    state.done = true;
  });
  return state;
};

it("keeps a fake-clock wait open while a child process runs longer than its idle turns", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* fakeClock();
      const child = slowChild();
      yield* settledUntil(() => child.done, 10);
      expect(child.done).toBe(true);
    }),
  ));

it("keeps a real-clock wait open while a child process runs longer than its idle polls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = slowChild();
      yield* waitFor(() => child.done, 5);
      expect(child.done).toBe(true);
    }),
  ));

it("fails a wait once its idle turns run out with no child process running", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* fakeClock();
      const exit = yield* Effect.exit(settledUntil(() => false, 10));
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      expect(String(failure)).toContain("timed out waiting for the orchestrator: () => false");
    }),
  ));
