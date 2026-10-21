import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";

import agentSessionBashPersistenceCases1 from "./agent-session-bash-persistence-cases-1.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness } = harnessModule;
const { getEntryTypes, harnesses } = agentSessionBashPersistenceCases1;

const { gate } = testing;

const defersBashResultsWhileStreamingAndSetup = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const toolRelease = gate();
    const waitTool: agentTypes.AgentTool = {
      description: "Wait for release",
      execute: () =>
        runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() => toolRelease);
            return {
              content: [{ text: "released", type: "text" }],
              details: {},
            };
          }),
        ),
      label: "Wait",
      name: "wait",
      parameters: Type.Object({}),
    };
    return { toolRelease, waitTool };
  });

const defersBashResultsWhileStreamingAnd = Effect.gen(function* () {
  const { toolRelease, waitTool } = yield* defersBashResultsWhileStreamingAndSetup();
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

  const firstPrompt = harness.session.run.prompting.prompt("start");
  yield* Effect.promise(() => sawToolStart);
  harness.session.context.bash.recordBashResult("echo hi", {
    cancelled: false,
    exitCode: 0,
    output: "hi",
    truncated: false,
  });

  expect(harness.session.context.bash.hasPendingBashMessages).toBe(true);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(false);

  toolRelease.release();
  yield* Effect.promise(() => firstPrompt);

  expect(harness.session.context.bash.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(true);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("next turn"));

  expect(harness.session.context.bash.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(true);
  expect(getEntryTypes(harness).filter((type) => type === "message").length).toBeGreaterThan(0);
});

const agentSessionBashPersistenceCases2 = {
  defersBashResultsWhileStreamingAnd,
};

export default agentSessionBashPersistenceCases2;
