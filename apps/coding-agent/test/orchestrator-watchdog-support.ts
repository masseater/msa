import { Effect } from "effect";
import { vi } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";

const { harness } = orchestratorHarness;

type Orchestrator = ReturnType<typeof harness.setup>["orchestrator"];

const fakeClock = () =>
  Effect.sync(() =>
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    }),
  );

const STEP_MS = 10_000;

const settle = Effect.callback<void>((resume) => {
  setImmediate(() => resume(Effect.void));
});

const advance = (ms: number) =>
  Effect.gen(function* () {
    yield* settle;
    for (let left = ms; left > 0; left -= STEP_MS) {
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(Math.min(STEP_MS, left)));
      yield* settle;
    }
  });

const storedStatus = (orchestrator: Orchestrator, taskId: string) =>
  (
    orchestrator.database.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as {
      status: string;
    }
  ).status;

const TASK = {
  currentState: "src/cache.ts has no cache",
  goalState: "repeated reads hit the cache",
  title: "cache reads",
};

const watchdogSupport = { TASK, advance, fakeClock, storedStatus };

export default watchdogSupport;
