import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentLoopModule from "../src/agent-loop.ts";
import type agentLoopTypes from "../src/agent-loop.types.ts";
import type typesModule from "../src/types.ts";
import fixtures from "./support/fixtures.ts";
import type fixturesTypes from "./support/fixtures.types.ts";

const { runToolCall } = agentLoopModule;

const { createAssistantMessage, echoSchema, toolCall } = fixtures;

const echo: typesModule.AgentTool<typeof echoSchema> = {
  description: "Echo tool",
  execute: (_toolCallId, params, _signal, onUpdate) => {
    onUpdate?.({ content: [{ text: "partial", type: "text" }], details: {} });
    return Promise.resolve({
      content: [{ text: params.value, type: "text" }],
      details: {},
      structuredContent: { value: params.value },
    });
  },
  label: "Echo",
  name: "echo",
  outputSchema: Type.Object({ value: Type.String() }),
  parameters: echoSchema,
};

const failing: typesModule.AgentTool = {
  description: "Returns an error result",
  execute: () =>
    Promise.resolve({
      content: [{ text: "bad", type: "text" }],
      details: { partial: true },
      isError: true,
    }),
  label: "Failing",
  name: "failing",
  parameters: Type.Object({}),
};

const assistantMessage = createAssistantMessage([]);

const run = (spec: fixturesTypes.CallSpec, options: agentLoopTypes.RunToolCallOptions) =>
  Effect.promise(() => runToolCall(toolCall(spec), options));

const hookedOptions = (
  hookCalls: string[],
  updates: unknown[],
): agentLoopTypes.RunToolCallOptions => ({
  afterToolCall: ({ toolCall: call }) => {
    hookCalls.push(`after ${call.id}`);
    return Promise.resolve(undefined);
  },
  assistantMessage,
  beforeToolCall: ({ toolCall: call, args }) => {
    hookCalls.push(`before ${call.id}`);
    return Promise.resolve(
      (args as { value?: string }).value === "blocked"
        ? { block: true, reason: "nope" }
        : undefined,
    );
  },
  context: { messages: [] },
  onUpdate: (partial) => {
    updates.push(partial);
  },
  tools: [echo, failing],
});

const validatesAndHooks = Effect.gen(function* () {
  const hookCalls: string[] = [];
  const updates: unknown[] = [];
  const options = hookedOptions(hookCalls, updates);
  expect(yield* run({ args: { value: "a" }, id: "a" }, options)).toMatchObject({
    isError: false,
    result: { structuredContent: { value: "a" } },
    toolCall: { id: "a" },
  });
  expect(yield* run({ args: { value: { nested: true } }, id: "b" }, options)).toMatchObject({
    isError: true,
  });
  expect(yield* run({ args: { value: "blocked" }, id: "c" }, options)).toMatchObject({
    isError: true,
    result: { content: [{ text: "nope", type: "text" }] },
  });
  expect(yield* run({ id: "d", name: "missing" }, options)).toMatchObject({
    isError: true,
    result: { content: [{ text: "Tool missing not found", type: "text" }] },
  });
  expect(yield* run({ id: "e", name: "failing" }, options)).toMatchObject({
    isError: true,
    result: { details: { partial: true } },
  });
  expect(updates).toEqual([{ content: [{ text: "partial", type: "text" }], details: {} }]);
  expect(hookCalls).toEqual(["before a", "after a", "before c", "before e", "after e"]);
});

const redacted = [{ text: "redacted", type: "text" as const }];

const afterResults: typesModule.AfterToolCallResult[] = [
  { content: redacted },
  { structuredContent: { value: "replaced" } },
  { content: redacted, structuredContent: { value: "both" } },
  { details: { note: "kept" } },
];

const replacesStructuredContent = Effect.gen(function* () {
  const seen = yield* Effect.forEach(afterResults, (afterResult) =>
    Effect.map(
      run(
        { args: { value: "original" }, id: "x" },
        {
          afterToolCall: () => Promise.resolve(afterResult),
          assistantMessage,
          context: { messages: [] },
          tools: [echo],
        },
      ),
      (outcome) => outcome.result.structuredContent,
    ),
  );
  expect(seen).toEqual([
    undefined,
    { value: "replaced" },
    { value: "both" },
    { value: "original" },
  ]);
});

describe("runToolCall", () => {
  it("validates, runs the hooks, and reports failures as error outcomes", () =>
    Effect.runPromise(validatesAndHooks));
  it("lets afterToolCall replace structured content and drops it when only content is replaced", () =>
    Effect.runPromise(replacesStructuredContent));
});
