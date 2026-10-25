import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { cleanupAll } = harnessModule;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness, getMessageText } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

const doesNotStartPreparedToolsAfterStep = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const executions: string[] = [];
    const preflights: string[] = [];
    const resultHooks: string[] = [];
    const externalWrite: agentTypes.AgentTool = {
      description: "Perform an external write",
      execute: (_toolCallId, params) =>
        runPromise(
          Effect.sync(() => {
            const value =
              typeof params === "object" && params !== null && "value" in params
                ? String(params.value)
                : "";
            executions.push(value);
            return { content: [{ text: value, type: "text" }], details: { value } };
          }),
        ),
      label: "External write",
      name: "external_write",
      parameters: Type.Object({ value: Type.String() }),
    };
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("tool_call", (event, ctx) =>
              runPromise(
                Effect.sync(() => {
                  const value = "value" in event.input ? String(event.input["value"]) : "";
                  preflights.push(value);
                  if (value === "second") ctx.abort();
                }),
              ),
            );
            msa.on("tool_result", (event) =>
              runPromise(
                Effect.sync(() => {
                  resultHooks.push(event.toolCallId);
                }),
              ),
            );
          },
        ],
        tools: [externalWrite],
      }),
    );
    return { executions, harness, preflights, resultHooks };
  });

const doesNotStartPreparedToolsAfter = Effect.gen(function* () {
  const { executions, harness, preflights, resultHooks } =
    yield* doesNotStartPreparedToolsAfterStep();
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("external_write", { value: "first" }),
        fauxToolCall("external_write", { value: "second" }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("run both writes"));

  expect(preflights).toEqual(["first", "second"]);
  expect(executions).toEqual([]);
  expect(resultHooks).toEqual([]);

  const starts = harness.eventsOfType("tool_execution_start");
  const ends = harness.eventsOfType("tool_execution_end");
  expect(starts).toHaveLength(2);
  expect(ends).toHaveLength(2);
  expect(new Set(ends.map((event) => event.toolCallId))).toEqual(
    new Set(starts.map((event) => event.toolCallId)),
  );
  expect(ends.every((event) => event.isError)).toBe(true);

  const toolResults = harness.session.messages.filter((message) => message.role === "toolResult");
  expect(toolResults.map((message) => message.toolCallId)).toEqual(
    starts.map((event) => event.toolCallId),
  );
  expect(toolResults.map(getMessageText)).toEqual(["Operation aborted", "Operation aborted"]);
});

const doesNotStartPreparedToolsAfterA = () => Effect.runPromise(doesNotStartPreparedToolsAfter);

const afterEachHook = () => cleanupAll(harnesses);

describe("#8935 parallel preflight abort", () => {
  afterEach(afterEachHook);
  it(
    "does not start prepared tools after a later preflight aborts",
    doesNotStartPreparedToolsAfterA,
  );
});
