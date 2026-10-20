import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness, getAssistantTexts } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

const letsAToolCallHandlerTerminate = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const echoTool: AgentTool = {
    description: "Echo text back",
    execute: () =>
      runPromise(
        Effect.sync(() => {
          throw new Error("tool should have been blocked");
        }),
      ),
    label: "Echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  };
  return yield* letsAToolCallHandlerTerminateStep1(echoTool);
});

const letsAToolCallHandlerTerminateStep1 = (echoTool: AgentTool<any, any>) =>
  Effect.gen(function* () {
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("tool_call", () =>
              Promise.resolve({
                block: true,
                reason: "Blocked by terminating policy",
                terminate: true,
              }),
            );
          },
        ],
        tools: [echoTool],
      }),
    );
    harnesses.push(harness);
    harness.setResponses([
      fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("should not run"),
    ]);
    yield* Effect.promise(() => harness.session.prompt("hi"));
    expect(harness.getPendingResponseCount()).toBe(1);
    expect(getAssistantTexts(harness)).not.toContain("should not run");
    expect(harness.eventsOfType("tool_execution_end")[0]?.result).toHaveProperty("terminate", true);
    return yield* letsAToolCallHandlerTerminateStep2(harness);
  });

const letsAToolCallHandlerTerminateStep2 = (harness: harnessTypes.Harness) =>
  Effect.sync(() => {
    expect(
      harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
    ).toBeDefined();
  });

const letsAToolCallHandlerTerminateThe = () => Effect.runPromise(letsAToolCallHandlerTerminate);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("#5998 blocked tool termination", () => {
  afterEach(afterEachHook);
  it(
    "lets a tool_call handler terminate the run after blocking execution",
    letsAToolCallHandlerTerminateThe,
  );
});
