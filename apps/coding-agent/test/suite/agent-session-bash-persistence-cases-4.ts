import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";
import { createHarness } from "./harness.ts";
import { harnesses } from "./agent-session-bash-persistence-cases-1.ts";
import { persistsUserAssistantToolresultAndCustomPart2 } from "./agent-session-bash-persistence-cases-3.ts";

export const persistsUserAssistantToolresultAndCustom = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          return { content: [{ type: "text", text: `echo:${text}` }], details: { text } };
        }),
      ),
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
export const doesNotEmitMessageEndFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const messageEndRoles: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "message_end") {
      messageEndRoles.push(event.message.role);
    }
  });

  harness.session.recordBashResult("echo hi", {
    output: "hi",
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });

  expect(messageEndRoles).toEqual([]);
});
