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

const simpleTextResponse = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ responses: ["hello world"] }));

      yield* awaited(harness.session.run.prompting.prompt("hi"));

      expect(harness.faux.callCount).toBe(1);

      const assistantMessages = harness.session.messages.filter((m) => m.role === "assistant");
      expect(assistantMessages).toHaveLength(1);

      const msg = assistantMessages[0] as aiTypes.AssistantMessage;
      expect(msg.content).toEqual([{ text: "hello world", type: "text" as const }]);
      expect(msg.stopReason).toBe("stop");
    }),
  );

const responseSequence = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ responses: ["first", "second", "third"] }));

      yield* awaited(harness.session.run.prompting.prompt("a"));
      yield* awaited(harness.session.run.prompting.prompt("b"));
      yield* awaited(harness.session.run.prompting.prompt("c"));

      expect(harness.faux.callCount).toBe(3);

      const assistantTexts = harness.session.messages
        .filter((m): m is aiTypes.AssistantMessage => m.role === "assistant")
        .map((m) => m.content.find((c) => c.type === "text")?.text);

      expect(assistantTexts).toEqual(["first", "second", "third"]);
    }),
  );

const toolCallResponseTriggersToolExecution = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      let toolExecuted = false;
      const echoTool: agentTypes.AgentTool = {
        description: "Echo back",
        execute: () =>
          effectRunPromise(
            Effect.gen(function* () {
              toolExecuted = true;
              return yield* awaited({
                content: [{ text: "echoed", type: "text" as const }],
                details: {},
              });
            }),
          ),
        label: "Echo",
        name: "echo",
        parameters: Type.Object({ text: Type.String() }),
      };

      harness = yield* awaited(
        createHarness({
          baseToolsOverride: { echo: echoTool },
          responses: [{ toolCalls: [{ args: { text: "hi" }, name: "echo" }] }, "done after tool"],
          tools: [echoTool],
        }),
      );

      yield* awaited(harness.session.run.prompting.prompt("use the tool"));

      expect(toolExecuted).toBe(true);
      expect(harness.faux.callCount).toBe(2);

      const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
      expect(toolResults).toHaveLength(1);
    }),
  );

const errorResponse = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(
        createHarness({
          responses: [{ error: "something broke" }],
        }),
      );

      yield* awaited(harness.session.run.prompting.prompt("hi"));

      const assistantMessages = harness.session.messages.filter(
        (m): m is aiTypes.AssistantMessage => m.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.stopReason).toBe("error");
      expect(assistantMessages[0]?.errorMessage).toBe("something broke");
    }),
  );

const turnsAPendingTerminalResponseIntoAn = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(
        createHarness({
          responses: [{ stopReason: "pending", text: "partial" }],
          settings: { retry: { enabled: false } },
        }),
      );

      yield* awaited(harness.session.run.prompting.prompt("hi"));

      const assistantMessages = harness.session.messages.filter(
        (m): m is aiTypes.AssistantMessage => m.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.stopReason).toBe("error");
      expect(assistantMessages[0]?.errorMessage).toBe("Faux response ended without a stop reason");
    }),
  );

const retryOnTransientError = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(
        createHarness({
          responses: [{ error: "overloaded_error" }, "recovered"],
          settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
        }),
      );

      yield* awaited(harness.session.run.prompting.prompt("hi"));

      expect(harness.faux.callCount).toBe(2);

      const retryStarts = harness.eventsOfType("auto_retry_start");
      expect(retryStarts).toHaveLength(1);

      const retryEnds = harness.eventsOfType("auto_retry_end");
      expect(retryEnds).toHaveLength(1);
      expect(retryEnds[0]?.success).toBe(true);
    }),
  );

const customUsageNumbers = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(
        createHarness({
          responses: [{ text: "big response", usage: { input: 100000, output: 5000 } }],
        }),
      );

      yield* awaited(harness.session.run.prompting.prompt("hi"));

      const msg = harness.session.messages.find(
        (m): m is aiTypes.AssistantMessage => m.role === "assistant",
      )!;
      expect(msg.usage.input).toBe(100000);
      expect(msg.usage.output).toBe(5000);
    }),
  );

describe("test harness", () => {
  afterEach(() => harness?.cleanup());

  it("simple text response", simpleTextResponse);

  it("response sequence", responseSequence);

  it("tool call response triggers tool execution", toolCallResponseTriggersToolExecution);

  it("error response", errorResponse);

  it("turns a pending terminal response into an error", turnsAPendingTerminalResponseIntoAn);

  it("retry on transient error", retryOnTransientError);

  it("custom usage numbers", customUsageNumbers);
});
