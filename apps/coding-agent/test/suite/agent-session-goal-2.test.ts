import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { GOAL_ENTRY_TYPE, type GoalEntryData } from "../../src/core/goal.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import agentSessionGoalSupport from "./agent-session-goal-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage } = ai;

const { goalEvents, harnesses, setup, touchTool, workTurn } = agentSessionGoalSupport;

const { createHarness } = harnessModule;

const waitsOutARateLimitAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: false } },
      tools: [touchTool],
    }),
  );
  harnesses.push(harness);
  harness.session.subscribe((event) => {
    if (
      event.type === "entry_appended" &&
      event.entry.type === "custom" &&
      (event.entry.data as GoalEntryData).event === "waiting"
    ) {
      void harness.session.abort();
    }
  });
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "429 Too Many Requests", stopReason: "error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("/goal anything"));

  expect(goalEvents(harness).at(-1)).toMatchObject({ delayMs: 60_000, event: "waiting" });
  expect(harness.session.goal?.condition).toBe("anything");
  expect(harness.session.isIdle).toBe(true);
});

const restoresAnUnfinishedGoalWhenThe = Effect.gen(function* () {
  const unfinished = SessionManager.inMemory();
  unfinished.appendCustomEntry(GOAL_ENTRY_TYPE, { condition: "keep going", event: "set" });
  expect((yield* Effect.promise(() => setup(unfinished))).session.goal).toMatchObject({
    condition: "keep going",
    turns: 0,
  });

  const finished = SessionManager.inMemory();
  finished.appendCustomEntry(GOAL_ENTRY_TYPE, { condition: "done", event: "set" });
  finished.appendCustomEntry(GOAL_ENTRY_TYPE, {
    condition: "done",
    elapsedMs: 1,
    event: "met",
    reason: "ok",
    tokens: 1,
    turns: 1,
  });
  expect((yield* Effect.promise(() => setup(finished))).session.goal).toBeUndefined();
});

const stopsTheLoopWhenTheRun = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() => setup());
  harness.setResponses([
    ...workTurn("working"),
    () =>
      runPromise(
        Effect.sync(() => {
          void harness.session.abort();
          return fauxAssistantMessage("", { stopReason: "aborted" });
        }),
      ),
  ]);

  yield* Effect.promise(() => harness.session.prompt("/goal long task"));

  expect(harness.session.goal?.condition).toBe("long task");
  expect(harness.session.isIdle).toBe(true);
});

const waitsOutARateLimitAndAn = () => Effect.runPromise(waitsOutARateLimitAnd);

const restoresAnUnfinishedGoalWhenTheSession = () =>
  Effect.runPromise(restoresAnUnfinishedGoalWhenThe);

const stopsTheLoopWhenTheRunIs = () => Effect.runPromise(stopsTheLoopWhenTheRun);

describe("AgentSession /goal", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "waits out a rate limit, and an abort during the wait keeps the goal",
    waitsOutARateLimitAndAn,
  );

  it(
    "restores an unfinished goal when the session is resumed, but not a finished one",
    restoresAnUnfinishedGoalWhenTheSession,
  );

  it("stops the loop when the run is aborted", stopsTheLoopWhenTheRunIs);
});
