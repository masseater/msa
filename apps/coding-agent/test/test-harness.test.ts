import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import testHarnessSupport from "./test-harness-support.ts";
import type testHarnessTypes from "./test-harness.types.ts";

const { assistantMessagesOf, textsOf, useHarness, withEchoTool } = testHarnessSupport;

const { runTest } = testing;

const run = useHarness();

const simpleTextResponse = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run({ responses: ["hello world"] }, "hi");

      expect(harness.faux.callCount).toBe(1);
      const [message, ...rest] = assistantMessagesOf(harness);
      expect(rest).toHaveLength(0);
      expect(message?.content).toEqual([{ text: "hello world", type: "text" as const }]);
      expect(message?.stopReason).toBe("stop");
    }),
  );

const responseSequence = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run({ responses: ["first", "second", "third"] }, "a", "b", "c");

      expect(harness.faux.callCount).toBe(3);
      expect(textsOf(harness)).toEqual(["first", "second", "third"]);
    }),
  );

const toolCallResponseTriggersToolExecution = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run(
        withEchoTool({
          responses: [{ toolCalls: [{ args: { text: "hi" }, name: "echo" }] }, "done after tool"],
        }),
        "use the tool",
      );

      expect(harness.faux.callCount).toBe(2);
      expect(harness.session.messages.filter((m) => m.role === "toolResult")).toHaveLength(1);
    }),
  );

const failedResponses: ReadonlyArray<
  readonly [name: string, options: testHarnessTypes.HarnessOptions, errorMessage: string]
> = [
  ["error response", { responses: [{ error: "something broke" }] }, "something broke"],
  [
    "a pending terminal response",
    {
      responses: [{ stopReason: "pending", text: "partial" }],
      settings: { retry: { enabled: false } },
    },
    "Faux response ended without a stop reason",
  ],
];

const failedResponse = (options: testHarnessTypes.HarnessOptions, errorMessage: string) =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run(options, "hi");

      const [message, ...rest] = assistantMessagesOf(harness);
      expect(rest).toHaveLength(0);
      expect(message?.stopReason).toBe("error");
      expect(message?.errorMessage).toBe(errorMessage);
    }),
  );

const retryOnTransientError = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run(
        {
          responses: [{ error: "overloaded_error" }, "recovered"],
          settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
        },
        "hi",
      );

      expect(harness.faux.callCount).toBe(2);
      expect(harness.eventsOfType("auto_retry_start")).toHaveLength(1);
      const retryEnds = harness.eventsOfType("auto_retry_end");
      expect(retryEnds).toHaveLength(1);
      expect(retryEnds[0]?.success).toBe(true);
    }),
  );

const customUsageNumbers = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* run(
        { responses: [{ text: "big response", usage: { input: 100000, output: 5000 } }] },
        "hi",
      );

      const message = assistantMessagesOf(harness)[0];
      expect(message?.usage.input).toBe(100000);
      expect(message?.usage.output).toBe(5000);
    }),
  );

describe("test harness", () => {
  it("simple text response", simpleTextResponse);

  it("response sequence", responseSequence);

  it("tool call response triggers tool execution", toolCallResponseTriggersToolExecution);

  for (const [name, options, errorMessage] of failedResponses) {
    it(`turns ${name} into an error`, () => failedResponse(options, errorMessage));
  }

  it("retry on transient error", retryOnTransientError);

  it("custom usage numbers", customUsageNumbers);
});
