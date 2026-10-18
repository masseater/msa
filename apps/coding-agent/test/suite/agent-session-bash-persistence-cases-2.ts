import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";
import { createHarness } from "./harness.ts";
import { getEntryTypes, harnesses } from "./agent-session-bash-persistence-cases-1.ts";

export const defersBashResultsWhileStreamingAnd = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRelease = gate();
  const waitTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for release",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => toolRelease);
          return {
            content: [{ type: "text", text: "released" }],
            details: {},
          };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [waitTool] }));
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("after flush"),
  ]);

  const sawToolStart = gate();
  {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        unsubscribe();
        sawToolStart.release();
      }
    });
  }

  const firstPrompt = harness.session.prompt("start");
  yield* Effect.promise(() => sawToolStart);
  harness.session.recordBashResult("echo hi", {
    output: "hi",
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });

  expect(harness.session.hasPendingBashMessages).toBe(true);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(false);

  toolRelease.release();
  yield* Effect.promise(() => firstPrompt);

  expect(harness.session.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(true);

  yield* Effect.promise(() => harness.session.prompt("next turn"));

  expect(harness.session.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(true);
  expect(getEntryTypes(harness).filter((type) => type === "message").length).toBeGreaterThan(0);
});
