import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import testHarness from "./test-harness.ts";
import type testHarnessTypes from "./test-harness.types.ts";

const { createHarness } = testHarness;

const { awaited, runTest } = testing;

let harness: testHarnessTypes.Harness;

const eventCapture = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ responses: ["hello"] }));

      yield* awaited(harness.session.prompt("hi"));

      const agentStarts = harness.eventsOfType("agent_start");
      expect(agentStarts).toHaveLength(1);

      const agentEnds = harness.eventsOfType("agent_end");
      expect(agentEnds).toHaveLength(1);

      const messageEnds = harness.eventsOfType("message_end");
      expect(messageEnds.length).toBeGreaterThanOrEqual(2);
    }),
  );

const contextCapture = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ responses: ["reply"] }));

      yield* awaited(harness.session.prompt("my question"));

      expect(harness.faux.contexts).toHaveLength(1);
      const ctx = harness.faux.contexts[0];
      const userMsg = ctx?.messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
    }),
  );

const wrapsAroundWhenMoreCallsThanResponses = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ responses: ["a", "b"] }));

      yield* awaited(harness.session.prompt("1"));
      yield* awaited(harness.session.prompt("2"));
      yield* awaited(harness.session.prompt("3"));

      expect(harness.faux.callCount).toBe(3);

      const texts = harness.session.messages
        .filter((m): m is aiTypes.AssistantMessage => m.role === "assistant")
        .map((m) => m.content.find((c) => c.type === "text")?.text);

      expect(texts).toEqual(["a", "b", "a"]);
    }),
  );

const streamsTextDeltas = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ responses: ["hello world"] }));

      yield* awaited(harness.session.prompt("hi"));

      const updates = harness.eventsOfType("message_update");
      const textDeltas = updates.filter((e) => e.assistantMessageEvent.type === "text_delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      const reconstructed = textDeltas
        .map((e) => (e.assistantMessageEvent as { delta: string }).delta)
        .join("");
      expect(reconstructed).toBe("hello world");
    }),
  );

const streamsThinkingDeltas = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(
        createHarness({
          responses: [{ text: "answer", thinking: "let me think about this" }],
        }),
      );

      yield* awaited(harness.session.prompt("hi"));

      const updates = harness.eventsOfType("message_update");
      const thinkingStarts = updates.filter(
        (e) => e.assistantMessageEvent.type === "thinking_start",
      );
      const thinkingDeltas = updates.filter(
        (e) => e.assistantMessageEvent.type === "thinking_delta",
      );
      const thinkingEnds = updates.filter((e) => e.assistantMessageEvent.type === "thinking_end");

      expect(thinkingStarts).toHaveLength(1);
      expect(thinkingDeltas.length).toBeGreaterThan(0);
      expect(thinkingEnds).toHaveLength(1);

      const reconstructed = thinkingDeltas
        .map((e) => (e.assistantMessageEvent as { delta: string }).delta)
        .join("");
      expect(reconstructed).toBe("let me think about this");
    }),
  );

const streamsToolCallDeltas = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const echoTool: agentTypes.AgentTool = {
        description: "Echo back",
        execute: () =>
          effectRunPromise(
            awaited({ content: [{ text: "echoed", type: "text" as const }], details: {} }),
          ),
        label: "Echo",
        name: "echo",
        parameters: Type.Object({ text: Type.String() }),
      };

      harness = yield* awaited(
        createHarness({
          baseToolsOverride: { echo: echoTool },
          responses: [{ toolCalls: [{ args: { text: "hi" }, name: "echo" }] }, "done"],
          tools: [echoTool],
        }),
      );

      yield* awaited(harness.session.prompt("use tool"));

      const updates = harness.eventsOfType("message_update");
      const toolcallStarts = updates.filter(
        (e) => e.assistantMessageEvent.type === "toolcall_start",
      );
      const toolcallDeltas = updates.filter(
        (e) => e.assistantMessageEvent.type === "toolcall_delta",
      );
      const toolcallEnds = updates.filter((e) => e.assistantMessageEvent.type === "toolcall_end");

      expect(toolcallStarts).toHaveLength(1);
      expect(toolcallDeltas.length).toBeGreaterThan(0);
      expect(toolcallEnds).toHaveLength(1);
    }),
  );

const streamsThinkingThenTextThenToolCall = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const echoTool: agentTypes.AgentTool = {
        description: "Echo back",
        execute: () =>
          effectRunPromise(
            awaited({ content: [{ text: "echoed", type: "text" as const }], details: {} }),
          ),
        label: "Echo",
        name: "echo",
        parameters: Type.Object({ text: Type.String() }),
      };

      harness = yield* awaited(
        createHarness({
          baseToolsOverride: { echo: echoTool },
          responses: [
            {
              text: "I will call a tool",
              thinking: "hmm",
              toolCalls: [{ args: { text: "x" }, name: "echo" }],
            },
            "final",
          ],
          tools: [echoTool],
        }),
      );

      yield* awaited(harness.session.prompt("do it"));

      const updates = harness.eventsOfType("message_update");
      const streamTypes = updates.map((e) => e.assistantMessageEvent.type);

      const firstThinking = streamTypes.indexOf("thinking_start");
      const firstText = streamTypes.indexOf("text_start");
      const firstToolcall = streamTypes.indexOf("toolcall_start");

      expect(firstThinking).toBeLessThan(firstText);
      expect(firstText).toBeLessThan(firstToolcall);
    }),
  );

describe("test harness", () => {
  afterEach(() => {
    harness?.cleanup();
  });

  it("event capture", eventCapture);

  it("context capture", contextCapture);

  it("wraps around when more calls than responses", wrapsAroundWhenMoreCallsThanResponses);

  it("streams text deltas", streamsTextDeltas);

  it("streams thinking deltas", streamsThinkingDeltas);

  it("streams tool call deltas", streamsToolCallDeltas);

  it("streams thinking then text then tool call in order", streamsThinkingThenTextThenToolCall);
});
