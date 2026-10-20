import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";

import agentSessionRetryEventsCases1 from "./agent-session-retry-events-cases-1.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxThinking, fauxToolCall } = ai;

const { createHarness } = harnessModule;
const { harnesses, normalizeEventOrder } = agentSessionRetryEventsCases1;

const waitsForTheFullLoopWhen = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const echoTool: agentTypes.AgentTool = {
    description: "Echo text back",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          toolRuns.push(text);
          return { content: [{ text: `echo:${text}`, type: "text" }], details: { text } };
        }),
      ),
    label: "Echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
      tools: [echoTool],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("final answer"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(harness.faux.state.callCount).toBe(3);
  expect(toolRuns).toEqual(["hello"]);
  expect(harness.session.isStreaming).toBe(false);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("follow-up"));
  expect(harness.faux.state.callCount).toBe(4);
});
const emitsExtensionEventsBeforePublicEventPart2 = (entry: {
  order: string[];
  harness: harnessTypes.Harness;
}): Effect.Effect<void, never, never> => {
  const { order, harness } = entry;
  return Effect.gen(function* () {
    harness.session.subscribe((event) => {
      if (event.type === "message_start" || event.type === "message_end") {
        order.push(`public:${event.type}:${event.message.role}`);
      }
    });
    harness.setResponses([fauxAssistantMessage("done")]);
    yield* Effect.promise(() => harness.session.run.prompting.prompt("hi"));
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
};
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
  return yield* emitsExtensionEventsBeforePublicEventPart2({ harness: harness, order: order });
});
const emitsTheExpectedEventOrderFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("hello")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hi"));

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
const emitsTheExpectedEventOrderFor2Part2 = (entry: {
  toolRuns: string[];
  harness: harnessTypes.Harness;
}): Effect.Effect<void, never, never> => {
  const { toolRuns, harness } = entry;
  return Effect.sync(() => {
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
};
const emitsTheExpectedEventOrderFor2 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const echoTool: agentTypes.AgentTool = {
    description: "Echo text back",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          toolRuns.push(text);
          return { content: [{ text: `echo:${text}`, type: "text" }], details: { text } };
        }),
      ),
    label: "Echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [echoTool] }));
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hi"));
  return yield* emitsTheExpectedEventOrderFor2Part2({ harness: harness, toolRuns: toolRuns });
});
const emitsStreamingDeltasForTextThinking = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxThinking("plan"),
        { text: "answer", type: "text" },
        fauxToolCall("echo", { text: "hello" }),
      ],
      {
        stopReason: "toolUse",
      },
    ),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hi").catch(() => {}));

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
  harness.setResponses([fauxAssistantMessage("", { errorMessage: "broken", stopReason: "error" })]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hi"));

  expect(harness.eventsOfType("agent_end")).toHaveLength(1);
  expect(harness.events[harness.events.length - 1]?.type).toBe("agent_settled");
});

const agentSessionRetryEventsCases2 = {
  emitsAgentEndForErrorResponses,
  emitsExtensionEventsBeforePublicEvent,
  emitsExtensionEventsBeforePublicEventPart2,
  emitsStreamingDeltasForTextThinking,
  emitsTheExpectedEventOrderFor,
  emitsTheExpectedEventOrderFor2,
  emitsTheExpectedEventOrderFor2Part2,
  waitsForTheFullLoopWhen,
};

export default agentSessionRetryEventsCases2;
