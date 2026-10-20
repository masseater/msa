import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

function createEchoTool(): AgentTool {
  return {
    description: "Echo text back",
    execute: (_toolCallId, params) =>
      Effect.runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          return { content: [{ text, type: "text" }], details: { text } };
        }),
      ),
    label: "Echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  };
}

const harnesses: harnessTypes.Harness[] = [];

const keepsPersistedAssistantToolresultMessageOrder = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
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
      tools: [createEchoTool()],
    }),
  );
  harnesses.push(harness);
  return yield* keepsPersistedAssistantToolresultMessageOrderStep1(harness);
});

const keepsPersistedAssistantToolresultMessageOrderStep1 = (harness: harnessTypes.Harness) =>
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
  let harness: harnessTypes.Harness;
  const branchRolesAtToolCall: string[][] = [];
  harness = yield* Effect.promise(() =>
    createHarness({
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
      tools: [createEchoTool()],
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

const keepsPersistedAssistantToolresultMessageOrderWhen = () =>
  Effect.runPromise(keepsPersistedAssistantToolresultMessageOrder);

const runsToolCallHandlersAfterTheAssistant = () => Effect.runPromise(runsToolCallHandlersAfterThe);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("regressions #1717/#2113: agent session event settlement", () => {
  afterEach(afterEachHook);
  it(
    "keeps persisted assistant/toolResult message order when extension message_end handlers yield",
    keepsPersistedAssistantToolresultMessageOrderWhen,
  );
  it(
    "runs tool_call handlers after the assistant tool-use message is settled in the session",
    runsToolCallHandlersAfterTheAssistant,
  );
});
