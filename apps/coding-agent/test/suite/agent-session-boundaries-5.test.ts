import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionBoundaries5Support from "./agent-session-boundaries-5-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses3 } = agentSessionBoundaries5Support;

const { createHarness, getMessageText } = harnessModule;

const { currentTimeMillis } = testing;

const keepsTruncatedToolAttemptsInContext = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let executed = false;
  const requests: string[] = [];
  const tool: agentTypes.AgentTool = {
    description: "Must not execute from a length response",
    execute: () =>
      runPromise(
        Effect.sync(() => {
          executed = true;
          return { content: [{ text: "executed", type: "text" }], details: {} };
        }),
      ),
    label: "Unsafe truncated tool",
    name: "unsafe_truncated_tool",
    parameters: Type.Object({ value: Type.String() }),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [tool] }));
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("unsafe_truncated_tool", { value: "partial" }), {
      stopReason: "length",
    }),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("completed natural continuation");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(executed).toBe(false);
  expect(harness.faux.state.callCount).toBe(2);
  expect(requests[0]).toContain("may be truncated");
  expect(harness.sessionManager.getEntries().some((entry) => entry.type === "context_edit")).toBe(
    false,
  );
});

const resetsLengthRecoveryAfterASuccessful = Effect.gen(function* () {
  const tool: agentTypes.AgentTool = {
    description: "Noop",
    execute: () => Promise.resolve({ content: [{ text: "done", type: "text" }], details: {} }),
    label: "Noop",
    name: "noop",
    parameters: Type.Object({}),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) => ({
            compaction: {
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              summary: "recovered input",
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
      models: [{ contextWindow: 1000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      tools: [tool],
    }),
  );
  harnesses3.push(harness);
  return yield* resetsLengthRecoveryAfterASuccessfulStep1(harness);
});

const resetsLengthRecoveryAfterASuccessfulStep1 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first partial", { stopReason: "length" }),
      fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" }),
      () =>
        fauxAssistantMessage("second partial", {
          stopReason: "length",
          timestamp: currentTimeMillis() + 1_000,
        }),
      () =>
        fauxAssistantMessage("completed second recovery", {
          timestamp: currentTimeMillis() + 2_000,
        }),
    ]);
    yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));
    const omittedIds = harness.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "context_edit")
      .map((entry) => entry.targetId);
    const lengthResponses = harness.sessionManager
      .getEntries()
      .filter(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          entry.message.stopReason === "length",
      );
    expect(lengthResponses).toHaveLength(2);
    expect(omittedIds).toEqual(expect.arrayContaining(lengthResponses.map((entry) => entry.id)));
    expect(harness.faux.state.callCount).toBe(3);
  });

const givesADistinctQueuedFollowUp = Effect.gen(function* () {
  let queued = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) => ({
            compaction: {
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              summary: "recovered input",
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
          msa.on("agent_end", (event) => {
            if (
              queued ||
              !event.messages.some((message) => getMessageText(message) === "first recovered")
            )
              return;
            queued = true;
            msa.sendUserMessage("distinct follow-up", { deliverAs: "followUp" });
          });
        },
      ],
      models: [{ contextWindow: 1000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses3.push(harness);
  return yield* givesADistinctQueuedFollowUpStep1(harness);
});

const givesADistinctQueuedFollowUpStep1 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first partial", { stopReason: "length" }),
      fauxAssistantMessage("first recovered"),
      () =>
        fauxAssistantMessage("follow-up partial", {
          stopReason: "length",
          timestamp: currentTimeMillis() + 1_000,
        }),
      () => fauxAssistantMessage("follow-up recovered", { timestamp: currentTimeMillis() + 2_000 }),
    ]);
    yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));
    const lengthIds = harness.sessionManager
      .getEntries()
      .flatMap((entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        entry.message.stopReason === "length"
          ? [entry.id]
          : [],
      );
    const omitted = harness.sessionManager
      .getEntries()
      .flatMap((entry) => (entry.type === "context_edit" ? [entry.targetId] : []));
    expect(lengthIds).toHaveLength(2);
    expect(omitted).toEqual(expect.arrayContaining(lengthIds));
    expect(harness.faux.state.callCount).toBe(4);
  });

const finishesRetryBookkeepingWhenARetry = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 2 } },
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("", { errorMessage: "invalid_api_key", stopReason: "error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.eventsOfType("auto_retry_end")).toContainEqual(
    expect.objectContaining({ attempt: 1, finalError: "invalid_api_key", success: false }),
  );
});

const keepsTruncatedToolAttemptsInContextFor = () =>
  Effect.runPromise(keepsTruncatedToolAttemptsInContext);

const resetsLengthRecoveryAfterASuccessfulIntermediate = () =>
  Effect.runPromise(resetsLengthRecoveryAfterASuccessful);

const givesADistinctQueuedFollowUpIts = () => Effect.runPromise(givesADistinctQueuedFollowUp);

const finishesRetryBookkeepingWhenARetryReceives = () =>
  Effect.runPromise(finishesRetryBookkeepingWhenARetry);

describe("durable length recovery", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });

  it(
    "keeps truncated tool attempts in context for the natural next turn",
    keepsTruncatedToolAttemptsInContextFor,
  );

  it(
    "resets length recovery after a successful intermediate assistant turn",
    resetsLengthRecoveryAfterASuccessfulIntermediate,
  );
});

describe("durable length recovery", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });

  it(
    "gives a distinct queued follow-up its own length-recovery budget",
    givesADistinctQueuedFollowUpIts,
  );

  it(
    "finishes retry bookkeeping when a retry receives a nonretryable error",
    finishesRetryBookkeepingWhenARetryReceives,
  );
});
