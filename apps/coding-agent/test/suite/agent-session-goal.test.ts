import { type TranscriptContext, fauxAssistantMessage, getCurrentSystemPrompt } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionGoalSupport from "./agent-session-goal-support.ts";
import harnessModule from "./harness.ts";

const { goalEvents, harnesses, setup, touchTool, workTurn } = agentSessionGoalSupport;

const { createHarness, getUserTexts } = harnessModule;

const { toJsonText } = testing;

function verdict(value: "not_met" | "met" | "impossible", reason: string) {
  return (context: TranscriptContext) => {
    if (!getCurrentSystemPrompt(context.messages).includes("completion condition")) {
      throw new Error("expected an evaluator request");
    }
    return fauxAssistantMessage(JSON.stringify({ reason, verdict: value }));
  };
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
    reason: "tests pass",
    turns: 2,
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
    fauxAssistantMessage("", { errorMessage: "401 Unauthorized", stopReason: "error" }),
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
      settings: { retry: { enabled: false } },
      tools: [touchTool],
    }),
  );
  harnesses.push(harness);
  const failure = () =>
    fauxAssistantMessage("", { errorMessage: "socket hang up", stopReason: "error" });
  harness.setResponses([failure(), failure(), failure()]);

  yield* Effect.promise(() => harness.session.prompt("/goal anything"));

  expect(harness.getPendingResponseCount()).toBe(0);
  expect(harness.session.goal?.condition).toBe("anything");
  expect(goalEvents(harness).at(-1)?.event).toBe("paused");
});

const worksFromTheConditionAloneAndStops = () => Effect.runPromise(worksFromTheConditionAloneAnd);

const endsTheGoalWhenTheEvaluatorSays = () => Effect.runPromise(endsTheGoalWhenTheEvaluator);

const handsControlBackAfterTurnsWithoutTool = () =>
  Effect.runPromise(handsControlBackAfterTurnsWithout);

const showsStatusAndClearsWithGoalClear = () => Effect.runPromise(showsStatusAndClearsWithGoal);

const replacesAnActiveGoalWithANew = () => Effect.runPromise(replacesAnActiveGoalWithA);

const rejectsConditionsOver4000Characters2 = () =>
  Effect.runPromise(rejectsConditionsOver4000Characters);

const clearsTheGoalOnAnAuthenticationFailure = () =>
  Effect.runPromise(clearsTheGoalOnAnAuthentication);

const retriesOtherErrorsAndPausesWithThe = () => Effect.runPromise(retriesOtherErrorsAndPausesWith);

describe("AgentSession /goal", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "works from the condition alone and stops when the evaluator says it is met",
    worksFromTheConditionAloneAndStops,
  );

  it("ends the goal when the evaluator says it is impossible", endsTheGoalWhenTheEvaluatorSays);

  it(
    "hands control back after turns without tool calls and keeps the goal",
    handsControlBackAfterTurnsWithoutTool,
  );

  it("shows status and clears with /goal clear or an alias", showsStatusAndClearsWithGoalClear);
});

describe("AgentSession /goal", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("replaces an active goal with a new one", replacesAnActiveGoalWithANew);

  it("rejects conditions over 4000 characters", rejectsConditionsOver4000Characters2);

  it("clears the goal on an authentication failure", clearsTheGoalOnAnAuthenticationFailure);

  it(
    "retries other errors and pauses with the goal kept when they repeat",
    retriesOtherErrorsAndPausesWithThe,
  );
});
