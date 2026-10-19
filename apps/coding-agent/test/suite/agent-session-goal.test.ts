import type { AgentTool } from "@msa/agent-core";
import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  type TranscriptContext,
} from "@msa/ai";
import { toJsonText } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { GOAL_ENTRY_TYPE, type GoalEntryData } from "../../src/core/goal.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getUserTexts, type Harness } from "./harness.ts";

const touchTool: AgentTool = {
  name: "touch",
  label: "Touch",
  description: "Do some work",
  parameters: Type.Object({}),
  execute: () => Promise.resolve({ content: [{ type: "text", text: "touched" }], details: {} }),
};

function workTurn(text: string): AssistantMessage[] {
  return [
    fauxAssistantMessage(fauxToolCall("touch", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(text),
  ];
}

function verdict(value: "not_met" | "met" | "impossible", reason: string) {
  return (context: TranscriptContext) => {
    if (!getCurrentSystemPrompt(context.messages).includes("completion condition")) {
      throw new Error("expected an evaluator request");
    }
    return fauxAssistantMessage(JSON.stringify({ verdict: value, reason }));
  };
}

function goalEvents(harness: Harness): GoalEntryData[] {
  return harness.sessionManager
    .getEntries()
    .flatMap((entry) =>
      entry.type === "custom" && entry.customType === GOAL_ENTRY_TYPE
        ? [entry.data as GoalEntryData]
        : [],
    );
}

const harnesses: Harness[] = [];

function setup(sessionManager?: SessionManager): Promise<Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          tools: [touchTool],
          ...(sessionManager === undefined ? {} : { sessionManager }),
        }),
      );
      harnesses.push(harness);
      return harness;
    }),
  );
}

const worksFromTheConditionAloneAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup());
  harness.setResponses([
    ...workTurn("tried once"),
    verdict("not_met", "tests still fail"),
    ...workTurn("fixed"),
    verdict("met", "tests pass"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("/goal make the tests pass"));

  expect(harness.getPendingResponseCount()).toBe(0);
  expect(getUserTexts(harness)).toEqual(["make the tests pass"]);
  expect(harness.session.goal).toBeUndefined();
  expect(goalEvents(harness).map((data) => data.event)).toEqual(["set", "evaluated", "met"]);
  expect(goalEvents(harness).at(-1)).toMatchObject({
    event: "met",
    turns: 2,
    reason: "tests pass",
  });
  const guidance = harness.session.messages.find(
    (message) => message.role === "custom" && message.customType === "msa.goal.continue",
  );
  expect(yield* toJsonText(guidance)).toContain("tests still fail");
  expect(harness.session.isIdle).toBe(true);
});

const endsTheGoalWhenTheEvaluator = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup());
  harness.setResponses([...workTurn("blocked"), verdict("impossible", "needs a password")]);

  yield* Effect.promise(() => harness.session.prompt("/goal deploy"));

  expect(harness.session.goal).toBeUndefined();
  expect(goalEvents(harness).at(-1)).toMatchObject({
    event: "impossible",
    reason: "needs a password",
  });
});

const handsControlBackAfterTurnsWithout = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup());
  harness.setResponses([
    fauxAssistantMessage("thinking"),
    verdict("not_met", "nothing done"),
    fauxAssistantMessage("still thinking"),
    verdict("not_met", "nothing done"),
    fauxAssistantMessage("more thinking"),
    verdict("not_met", "nothing done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("/goal ship it"));

  expect(harness.getPendingResponseCount()).toBe(0);
  expect(harness.session.goal?.condition).toBe("ship it");
  expect(harness.session.goal?.turns).toBe(3);
  expect(goalEvents(harness).at(-1)?.event).toBe("paused");

  harness.setResponses([...workTurn("done"), verdict("met", "shipped")]);
  yield* Effect.promise(() => harness.session.prompt("go on"));
  expect(harness.session.goal).toBeUndefined();
});

const showsStatusAndClearsWithGoal = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup());
  harness.session.setGoal("first");
  yield* Effect.promise(() => harness.session.prompt("/goal"));
  expect(harness.eventsOfType("goal_status").at(-1)?.goal?.condition).toBe("first");

  yield* Effect.promise(() => harness.session.prompt("/goal stop"));
  expect(harness.session.goal).toBeUndefined();
  expect(goalEvents(harness).map((data) => data.event)).toEqual(["set", "cleared"]);

  yield* Effect.promise(() => harness.session.prompt("/goal clear"));
  expect(harness.eventsOfType("goal_status").at(-1)?.goal).toBeUndefined();
});

const replacesAnActiveGoalWithA = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup());
  harness.session.setGoal("first");
  harness.session.setGoal("second");
  expect(harness.session.goal?.condition).toBe("second");
});

const rejectsConditionsOver4000Characters = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup());
  yield* Effect.promise(() =>
    expect(harness.session.prompt(`/goal ${"x".repeat(4001)}`)).rejects.toThrow("4000"),
  );
  expect(harness.session.goal).toBeUndefined();
});

const clearsTheGoalOnAnAuthentication = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup());
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 Unauthorized" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("/goal anything"));

  expect(harness.session.goal).toBeUndefined();
  expect(goalEvents(harness).at(-1)).toMatchObject({
    event: "failed",
    reason: "401 Unauthorized",
  });
});

const retriesOtherErrorsAndPausesWith = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [touchTool],
      settings: { retry: { enabled: false } },
    }),
  );
  harnesses.push(harness);
  const failure = () =>
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "socket hang up" });
  harness.setResponses([failure(), failure(), failure()]);

  yield* Effect.promise(() => harness.session.prompt("/goal anything"));

  expect(harness.getPendingResponseCount()).toBe(0);
  expect(harness.session.goal?.condition).toBe("anything");
  expect(goalEvents(harness).at(-1)?.event).toBe("paused");
});

const waitsOutARateLimitAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [touchTool],
      settings: { retry: { enabled: false } },
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
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 Too Many Requests" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("/goal anything"));

  expect(goalEvents(harness).at(-1)).toMatchObject({ event: "waiting", delayMs: 60_000 });
  expect(harness.session.goal?.condition).toBe("anything");
  expect(harness.session.isIdle).toBe(true);
});

const restoresAnUnfinishedGoalWhenThe = Effect.gen(function* () {
  const unfinished = SessionManager.inMemory();
  unfinished.appendCustomEntry(GOAL_ENTRY_TYPE, { event: "set", condition: "keep going" });
  expect((yield* Effect.promise(() => setup(unfinished))).session.goal).toMatchObject({
    condition: "keep going",
    turns: 0,
  });

  const finished = SessionManager.inMemory();
  finished.appendCustomEntry(GOAL_ENTRY_TYPE, { event: "set", condition: "done" });
  finished.appendCustomEntry(GOAL_ENTRY_TYPE, {
    event: "met",
    condition: "done",
    reason: "ok",
    turns: 1,
    elapsedMs: 1,
    tokens: 1,
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

describe("AgentSession /goal", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it("works from the condition alone and stops when the evaluator says it is met", () =>
    Effect.runPromise(worksFromTheConditionAloneAnd));
  it("ends the goal when the evaluator says it is impossible", () =>
    Effect.runPromise(endsTheGoalWhenTheEvaluator));
  it("hands control back after turns without tool calls and keeps the goal", () =>
    Effect.runPromise(handsControlBackAfterTurnsWithout));
  it("shows status and clears with /goal clear or an alias", () =>
    Effect.runPromise(showsStatusAndClearsWithGoal));
  it("replaces an active goal with a new one", () => Effect.runPromise(replacesAnActiveGoalWithA));
  it("rejects conditions over 4000 characters", () =>
    Effect.runPromise(rejectsConditionsOver4000Characters));
  it("clears the goal on an authentication failure", () =>
    Effect.runPromise(clearsTheGoalOnAnAuthentication));
  it("retries other errors and pauses with the goal kept when they repeat", () =>
    Effect.runPromise(retriesOtherErrorsAndPausesWith));
  it("waits out a rate limit, and an abort during the wait keeps the goal", () =>
    Effect.runPromise(waitsOutARateLimitAnd));
  it("restores an unfinished goal when the session is resumed, but not a finished one", () =>
    Effect.runPromise(restoresAnUnfinishedGoalWhenThe));
  it("stops the loop when the run is aborted", () => Effect.runPromise(stopsTheLoopWhenTheRun));
});
