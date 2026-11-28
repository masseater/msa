import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import testHarnessSupport from "./test-harness-support.ts";
import type testHarnessTypes from "./test-harness.types.ts";

const { deltaTextOf, textsOf, updatesOfType, useHarness, withEchoTool } = testHarnessSupport;

const { runTest } = testing;

const run = useHarness();

const eventCapture = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run({ responses: ["hello"] }, "hi");

      expect(harness.eventsOfType("agent_start")).toHaveLength(1);
      expect(harness.eventsOfType("agent_end")).toHaveLength(1);
      expect(harness.eventsOfType("message_end").length).toBeGreaterThanOrEqual(2);
    }),
  );

const contextCapture = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run({ responses: ["reply"] }, "my question");

      expect(harness.faux.contexts).toHaveLength(1);
      expect(harness.faux.contexts[0]?.messages.find((m) => m.role === "user")).toBeDefined();
    }),
  );

const wrapsAroundWhenMoreCallsThanResponses = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run({ responses: ["a", "b"] }, "1", "2", "3");

      expect(harness.faux.callCount).toBe(3);
      expect(textsOf(harness)).toEqual(["a", "b", "a"]);
    }),
  );

const streamsDeltas = (
  kind: "text" | "thinking",
  response: testHarnessTypes.FauxResponseInput,
  expected: string,
) =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run({ responses: [response] }, "hi");

      const deltas = updatesOfType(harness, `${kind}_delta`);
      expect(deltas.length).toBeGreaterThan(0);
      expect(updatesOfType(harness, `${kind}_start`)).toHaveLength(1);
      expect(updatesOfType(harness, `${kind}_end`)).toHaveLength(1);
      expect(deltaTextOf(deltas)).toBe(expected);
    }),
  );

const streamsToolCallDeltas = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run(
        withEchoTool({
          responses: [{ toolCalls: [{ args: { text: "hi" }, name: "echo" }] }, "done"],
        }),
        "use tool",
      );

      expect(updatesOfType(harness, "toolcall_start")).toHaveLength(1);
      expect(updatesOfType(harness, "toolcall_delta").length).toBeGreaterThan(0);
      expect(updatesOfType(harness, "toolcall_end")).toHaveLength(1);
    }),
  );

const streamsThinkingThenTextThenToolCall = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run(
        withEchoTool({
          responses: [
            {
              text: "I will call a tool",
              thinking: "hmm",
              toolCalls: [{ args: { text: "x" }, name: "echo" }],
            },
            "final",
          ],
        }),
        "do it",
      );

      const streamTypes = harness
        .eventsOfType("message_update")
        .map((event) => event.assistantMessageEvent.type);
      const firstThinking = streamTypes.indexOf("thinking_start");
      const firstText = streamTypes.indexOf("text_start");
      const firstToolcall = streamTypes.indexOf("toolcall_start");

      expect(firstThinking).toBeLessThan(firstText);
      expect(firstText).toBeLessThan(firstToolcall);
    }),
  );

describe("test harness", () => {
  it("event capture", eventCapture);

  it("context capture", contextCapture);

  it("wraps around when more calls than responses", wrapsAroundWhenMoreCallsThanResponses);

  it("streams text deltas", () => streamsDeltas("text", "hello world", "hello world"));

  it("streams thinking deltas", () =>
    streamsDeltas(
      "thinking",
      { text: "answer", thinking: "let me think about this" },
      "let me think about this",
    ));

  it("streams tool call deltas", streamsToolCallDeltas);

  it("streams thinking then text then tool call in order", streamsThinkingThenTextThenToolCall);
});
