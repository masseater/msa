import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { type RunToolCallOptions, runToolCall } from "../src/agent-loop.ts";
import type { AfterToolCallResult, AgentTool } from "../src/types.ts";
import { createAssistantMessage, echoSchema, type CallSpec, toolCall } from "./support/fixtures.ts";

const echo: AgentTool<typeof echoSchema> = {
  name: "echo",
  label: "Echo",
  description: "Echo tool",
  parameters: echoSchema,
  outputSchema: Type.Object({ value: Type.String() }),
  execute: (_toolCallId, params, _signal, onUpdate) => {
    onUpdate?.({ content: [{ type: "text", text: "partial" }], details: {} });
    return Promise.resolve({
      content: [{ type: "text", text: params.value }],
      details: {},
      structuredContent: { value: params.value },
    });
  },
};

const failing: AgentTool = {
  name: "failing",
  label: "Failing",
  description: "Returns an error result",
  parameters: Type.Object({}),
  execute: () =>
    Promise.resolve({
      content: [{ type: "text", text: "bad" }],
      details: { partial: true },
      isError: true,
    }),
};

const assistantMessage = createAssistantMessage([]);

const run = (spec: CallSpec, options: RunToolCallOptions) =>
  Effect.promise(() => runToolCall(toolCall(spec), options));

const hookedOptions = (hookCalls: string[], updates: unknown[]): RunToolCallOptions => ({
  tools: [echo, failing],
  assistantMessage,
  context: { messages: [] },
  beforeToolCall: ({ toolCall: call, args }) => {
    hookCalls.push(`before ${call.id}`);
    return Promise.resolve(
      (args as { value?: string }).value === "blocked"
        ? { block: true, reason: "nope" }
        : undefined,
    );
  },
  afterToolCall: ({ toolCall: call }) => {
    hookCalls.push(`after ${call.id}`);
    return Promise.resolve(undefined);
  },
  onUpdate: (partial) => {
    updates.push(partial);
  },
});

const validatesAndHooks = Effect.gen(function* () {
  const hookCalls: string[] = [];
  const updates: unknown[] = [];
  const options = hookedOptions(hookCalls, updates);
  expect(yield* run({ id: "a", args: { value: "a" } }, options)).toMatchObject({
    toolCall: { id: "a" },
    result: { structuredContent: { value: "a" } },
    isError: false,
  });
  expect(yield* run({ id: "b", args: { value: { nested: true } } }, options)).toMatchObject({
    isError: true,
  });
  expect(yield* run({ id: "c", args: { value: "blocked" } }, options)).toMatchObject({
    result: { content: [{ type: "text", text: "nope" }] },
    isError: true,
  });
  expect(yield* run({ id: "d", name: "missing" }, options)).toMatchObject({
    result: { content: [{ type: "text", text: "Tool missing not found" }] },
    isError: true,
  });
  expect(yield* run({ id: "e", name: "failing" }, options)).toMatchObject({
    result: { details: { partial: true } },
    isError: true,
  });
  expect(updates).toEqual([{ content: [{ type: "text", text: "partial" }], details: {} }]);
  expect(hookCalls).toEqual(["before a", "after a", "before c", "before e", "after e"]);
});

const redacted = [{ type: "text" as const, text: "redacted" }];

const afterResults: AfterToolCallResult[] = [
  { content: redacted },
  { structuredContent: { value: "replaced" } },
  { content: redacted, structuredContent: { value: "both" } },
  { details: { note: "kept" } },
];

const replacesStructuredContent = Effect.gen(function* () {
  const seen = yield* Effect.forEach(afterResults, (afterResult) =>
    Effect.map(
      run(
        { id: "x", args: { value: "original" } },
        {
          tools: [echo],
          assistantMessage,
          context: { messages: [] },
          afterToolCall: () => Promise.resolve(afterResult),
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
