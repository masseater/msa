import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxThinking, fauxToolCall } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, type Harness } from "./harness.ts";

function normalizeEventOrder(events: Harness["events"]): string[] {
  const normalized: string[] = [];
  for (const event of events) {
    const label =
      event.type === "message_start" || event.type === "message_end"
        ? `${event.type}:${event.message.role}`
        : event.type === "tool_execution_start" || event.type === "tool_execution_end"
          ? `${event.type}:${event.toolName}`
          : event.type;
    if (label === "message_update" && normalized[normalized.length - 1] === "message_update") {
      continue;
    }
    normalized.push(label);
  }
  return normalized;
}

const harnesses: Harness[] = [];

const retriesAfterATransientErrorAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "end:true"]);
  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([true, false]);
  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.session.isRetrying).toBe(false);
});

const retriesMultipleTransientFailuresAndSucceeds = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("success"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "start:2", "end:true"]);
  expect(harness.faux.state.callCount).toBe(3);
});

const finalizesRetryStateWhenAbortIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 0 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  let errorCount = 0;
  harness.session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    if (event.message.stopReason === "error" && ++errorCount === 2) void harness.session.abort();
  });

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.session.retryAttempt).toBe(0);
  expect(harness.eventsOfType("agent_end").at(-1)?.willRetry).toBe(false);
  expect(harness.eventsOfType("auto_retry_end").at(-1)).toMatchObject({
    success: false,
    attempt: 1,
    finalError: "Retry cancelled",
  });
});

const exhaustsMaxRetriesAndEmitsA = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "start:2", "end:false"]);
  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([
    true,
    true,
    false,
  ]);
  expect(harness.faux.state.callCount).toBe(3);
  expect(harness.session.isRetrying).toBe(false);
});

const promptWaitsForRetryCompletionEven = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("message_end", (event) =>
            runPromise(
              Effect.gen(function* () {
                if (event.message.role === "assistant") {
                  yield* Effect.sleep(40);
                }
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.session.isRetrying).toBe(false);
});

const doesNotRetryWhenRetryIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ settings: { retry: { enabled: false } } }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
});

const doesNotRetryNonRetryableErrors = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "invalid_api_key" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
});

const cancelsRetrySleepWhenAbortretryIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 100 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  const sawRetryStart = gate();
  {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "auto_retry_start") {
        unsubscribe();
        sawRetryStart.release();
      }
    });
  }

  const promptPromise = harness.session.prompt("test");
  yield* Effect.promise(() => sawRetryStart);
  harness.session.abortRetry();
  yield* Effect.promise(() => promptPromise);

  expect(harness.session.isRetrying).toBe(false);
  expect(harness.eventsOfType("auto_retry_end").map((event) => event.finalError)).toContain(
    "Retry cancelled",
  );
  expect(harness.faux.state.callCount).toBe(1);
});

const waitsForTheFullLoopWhen = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          toolRuns.push(text);
          return { content: [{ type: "text", text: `echo:${text}` }], details: { text } };
        }),
      ),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [echoTool],
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("final answer"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(3);
  expect(toolRuns).toEqual(["hello"]);
  expect(harness.session.isStreaming).toBe(false);
  yield* Effect.promise(() => harness.session.prompt("follow-up"));
  expect(harness.faux.state.callCount).toBe(4);
});

const emitsExtensionEventsBeforePublicEvent = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const order: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("message_start", (event) =>
            runPromise(
              Effect.sync(() => {
                order.push(`extension:${event.type}:${event.message.role}`);
              }),
            ),
          );
          msa.on("message_end", (event) =>
            runPromise(
              Effect.sync(() => {
                order.push(`extension:${event.type}:${event.message.role}`);
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* emitsExtensionEventsBeforePublicEventPart2(order, harness);
});

const emitsExtensionEventsBeforePublicEventPart2 = (order: string[], harness: Harness) =>
  Effect.gen(function* () {
    harness.session.subscribe((event) => {
      if (event.type === "message_start" || event.type === "message_end") {
        order.push(`public:${event.type}:${event.message.role}`);
      }
    });
    harness.setResponses([fauxAssistantMessage("done")]);
    yield* Effect.promise(() => harness.session.prompt("hi"));
    expect(order).toEqual([
      "extension:message_start:system",
      "public:message_start:system",
      "extension:message_end:system",
      "public:message_end:system",
      "extension:message_start:user",
      "public:message_start:user",
      "extension:message_end:user",
      "public:message_end:user",
      "extension:message_start:assistant",
      "public:message_start:assistant",
      "extension:message_end:assistant",
      "public:message_end:assistant",
    ]);
  });

const emitsTheExpectedEventOrderFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("hello")]);

  yield* Effect.promise(() => harness.session.prompt("hi"));

  expect(normalizeEventOrder(harness.events)).toEqual([
    "agent_start",
    "turn_start",
    "message_start:system",
    "message_end:system",
    "message_start:user",
    "message_end:user",
    "message_start:assistant",
    "message_update",
    "message_end:assistant",
    "turn_end",
    "agent_end",
    "agent_settled",
  ]);
});

const emitsTheExpectedEventOrderFor2 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          toolRuns.push(text);
          return { content: [{ type: "text", text: `echo:${text}` }], details: { text } };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [echoTool] }));
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("hi"));
  return yield* emitsTheExpectedEventOrderFor2Part2(toolRuns, harness);
});

const emitsTheExpectedEventOrderFor2Part2 = (toolRuns: string[], harness: Harness) =>
  Effect.sync(() => {
    expect(toolRuns).toEqual(["hello"]);
    expect(normalizeEventOrder(harness.events)).toEqual([
      "agent_start",
      "turn_start",
      "message_start:system",
      "message_end:system",
      "message_start:user",
      "message_end:user",
      "message_start:assistant",
      "message_update",
      "message_end:assistant",
      "tool_execution_start:echo",
      "tool_execution_end:echo",
      "message_start:toolResult",
      "message_end:toolResult",
      "turn_end",
      "turn_start",
      "message_start:assistant",
      "message_update",
      "message_end:assistant",
      "turn_end",
      "agent_end",
      "agent_settled",
    ]);
  });

const emitsStreamingDeltasForTextThinking = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxThinking("plan"),
        { type: "text", text: "answer" },
        fauxToolCall("echo", { text: "hello" }),
      ],
      {
        stopReason: "toolUse",
      },
    ),
  ]);

  yield* Effect.promise(() => harness.session.prompt("hi").catch(() => {}));

  const updateTypes = harness
    .eventsOfType("message_update")
    .map((event) => event.assistantMessageEvent.type);
  expect(updateTypes).toContain("thinking_delta");
  expect(updateTypes).toContain("text_delta");
  expect(updateTypes).toContain("toolcall_delta");
});

const emitsAgentEndForErrorResponses = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "broken" })]);

  yield* Effect.promise(() => harness.session.prompt("hi"));

  expect(harness.eventsOfType("agent_end")).toHaveLength(1);
  expect(harness.events[harness.events.length - 1]?.type).toBe("agent_settled");
});

const emitsAgentEndForAbortedRuns = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("x".repeat(20_000))]);

  const sawMessageUpdate = gate();
  {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "message_update") {
        unsubscribe();
        sawMessageUpdate.release();
      }
    });
  }

  const promptPromise = harness.session.prompt("hi");
  yield* Effect.promise(() => sawMessageUpdate);
  yield* Effect.promise(() => harness.session.abort());
  yield* Effect.promise(() => promptPromise);

  expect(harness.eventsOfType("agent_end")).toHaveLength(1);
  expect(harness.events[harness.events.length - 1]?.type).toBe("agent_settled");
  const lastMessage = harness.session.messages[harness.session.messages.length - 1];
  expect(lastMessage?.role).toBe("assistant");
  if (lastMessage?.role === "assistant") {
    expect(lastMessage.stopReason).toBe("aborted");
  }
});

describe("AgentSession retry and event characterization", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("retries after a transient error and succeeds", () =>
    Effect.runPromise(retriesAfterATransientErrorAnd));
  it("retries multiple transient failures and succeeds on the final attempt", () =>
    Effect.runPromise(retriesMultipleTransientFailuresAndSucceeds));
  it("finalizes retry state when abort is requested after a retry attempt fails", () =>
    Effect.runPromise(finalizesRetryStateWhenAbortIs));
  it("exhausts max retries and emits a failure event", () =>
    Effect.runPromise(exhaustsMaxRetriesAndEmitsA));
  it("prompt waits for retry completion even when assistant message_end handling is delayed", () =>
    Effect.runPromise(promptWaitsForRetryCompletionEven));
  it("does not retry when retry is disabled", () => Effect.runPromise(doesNotRetryWhenRetryIs));
  it("does not retry non-retryable errors", () =>
    Effect.runPromise(doesNotRetryNonRetryableErrors));
  it("cancels retry sleep when abortRetry is called", () =>
    Effect.runPromise(cancelsRetrySleepWhenAbortretryIs));
  it("waits for the full loop when retry recovery produces tool calls", () =>
    Effect.runPromise(waitsForTheFullLoopWhen));
  it("emits extension events before public event subscribers", () =>
    Effect.runPromise(emitsExtensionEventsBeforePublicEvent));
  it("emits the expected event order for a single prompt", () =>
    Effect.runPromise(emitsTheExpectedEventOrderFor));
  it("emits the expected event order for a tool call turn", () =>
    Effect.runPromise(emitsTheExpectedEventOrderFor2));
  it("emits streaming deltas for text, thinking, and tool calls in message_update events", () =>
    Effect.runPromise(emitsStreamingDeltasForTextThinking));
  it("emits agent_end for error responses", () =>
    Effect.runPromise(emitsAgentEndForErrorResponses));
  it("emits agent_end for aborted runs and persists the aborted assistant message", () =>
    Effect.runPromise(emitsAgentEndForAbortedRuns));
});
