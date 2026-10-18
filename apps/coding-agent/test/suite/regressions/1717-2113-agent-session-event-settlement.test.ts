import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, type Harness } from "../harness.ts";

function createEchoTool(): AgentTool {
  return {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_toolCallId, params) =>
      Effect.runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          return { content: [{ type: "text", text }], details: { text } };
        }),
      ),
  };
}

const harnesses: Harness[] = [];

const keepsPersistedAssistantToolresultMessageOrder = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [createEchoTool()],
      extensionFactories: [
        (msa) => {
          msa.on("message_end", (event) =>
            runPromise(
              Effect.gen(function* () {
                if (event.message.role === "assistant") {
                  yield* Effect.sleep(20);
                }
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* keepsPersistedAssistantToolresultMessageOrderPart2(harness);
});

const keepsPersistedAssistantToolresultMessageOrderPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("echo", { text: "one" }), fauxToolCall("echo", { text: "two" })],
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("done"),
    ]);
    yield* Effect.promise(() => harness.session.prompt("run tools"));
    const branchMessages = harness.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message);
    expect(branchMessages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "toolResult",
      "toolResult",
      "assistant",
    ]);
    const firstToolResultIndex = branchMessages.findIndex(
      (message) => message.role === "toolResult",
    );
    expect(firstToolResultIndex).toBeGreaterThan(0);
    expect(branchMessages[firstToolResultIndex - 1]?.role).toBe("assistant");
  });

const runsToolCallHandlersAfterThe = Effect.gen(function* () {
  let harness: Harness;
  const branchRolesAtToolCall: string[][] = [];
  harness = yield* Effect.promise(() =>
    createHarness({
      tools: [createEchoTool()],
      extensionFactories: [
        (msa) => {
          msa.on("tool_call", () => {
            branchRolesAtToolCall.push(
              harness.sessionManager
                .getBranch()
                .filter((entry) => entry.type === "message")
                .map((entry) => entry.message.role),
            );
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("run tool"));

  expect(branchRolesAtToolCall).toEqual([["system", "user", "assistant"]]);
});

describe("regressions #1717/#2113: agent session event settlement", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("keeps persisted assistant/toolResult message order when extension message_end handlers yield", () =>
    Effect.runPromise(keepsPersistedAssistantToolresultMessageOrder));
  it("runs tool_call handlers after the assistant tool-use message is settled in the session", () =>
    Effect.runPromise(runsToolCallHandlersAfterThe));
});
