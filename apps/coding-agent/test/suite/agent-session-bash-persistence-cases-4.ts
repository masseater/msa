import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";

import agentSessionBashPersistenceCases1 from "./agent-session-bash-persistence-cases-1.ts";
import agentSessionBashPersistenceCases3 from "./agent-session-bash-persistence-cases-3.ts";
import harnessModule from "./harness.ts";

const { createHarness } = harnessModule;
const { harnesses } = agentSessionBashPersistenceCases1;
const { persistsUserAssistantToolresultAndCustomPart2 } = agentSessionBashPersistenceCases3;

const persistsUserAssistantToolresultAndCustom = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const echoTool: AgentTool = {
    description: "Echo text back",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          return { content: [{ text: `echo:${text}`, type: "text" }], details: { text } };
        }),
      ),
    label: "Echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [echoTool] }));
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  return yield* persistsUserAssistantToolresultAndCustomPart2(harness);
});
const doesNotEmitMessageEndFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const messageEndRoles: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "message_end") {
      messageEndRoles.push(event.message.role);
    }
  });

  harness.session.recordBashResult("echo hi", {
    cancelled: false,
    exitCode: 0,
    output: "hi",
    truncated: false,
  });

  expect(messageEndRoles).toEqual([]);
});

const agentSessionBashPersistenceCases4 = {
  doesNotEmitMessageEndFor,
  persistsUserAssistantToolresultAndCustom,
};

export default agentSessionBashPersistenceCases4;
