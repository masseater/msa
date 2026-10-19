import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, getAssistantTexts, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

const letsAToolCallHandlerTerminate = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: () =>
      runPromise(
        Effect.sync(() => {
          throw new Error("tool should have been blocked");
        }),
      ),
  };
  return yield* letsAToolCallHandlerTerminatePart2(echoTool);
});

const letsAToolCallHandlerTerminatePart2 = (echoTool: AgentTool<any, any>) =>
  Effect.gen(function* () {
    const harness = yield* Effect.promise(() =>
      createHarness({
        tools: [echoTool],
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
    return yield* letsAToolCallHandlerTerminatePart3(harness);
  });

const letsAToolCallHandlerTerminatePart3 = (harness: Harness) =>
  Effect.sync(() => {
    expect(
      harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
    ).toBeDefined();
  });

describe("#5998 blocked tool termination", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("lets a tool_call handler terminate the run after blocking execution", () =>
    Effect.runPromise(letsAToolCallHandlerTerminate));
});
