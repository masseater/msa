import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentLoopModule from "../src/agent-loop.ts";
import type typesModule from "../src/types.ts";
import fixtures from "./support/fixtures.ts";

const { agentLoop } = agentLoopModule;

const {
  collect,
  createModel,
  createUserMessage,
  delayed,
  echoResult,
  identityConverter,
  scripted,
  stoppedWith,
  textMessage,
  tool,
  toolCallMessage,
} = fixtures;

const usage = (base: number, total: number) => ({
  cacheRead: base + 2,
  cacheWrite: base + 3,
  cost: {
    cacheRead: (base + 2) / 10,
    cacheWrite: (base + 3) / 10,
    input: base / 10,
    output: (base + 1) / 10,
    total: total / 10,
  },
  input: base,
  output: base + 1,
  totalTokens: total,
});

const toolUsage = usage(1, 10);
const patchedToolUsage = usage(5, 26);

const handlesToolCalls = Effect.gen(function* () {
  const executed: string[] = [];
  let observedToolUsage: unknown;
  const echo = tool({
    run: (_id, params) => {
      executed.push(params.value);
      return Promise.resolve({ ...echoResult(params.value), usage: toolUsage });
    },
  });
  const config: typesModule.AgentLoopConfig = {
    afterToolCall: ({ result }) => {
      observedToolUsage = result.usage;
      return Promise.resolve({ usage: patchedToolUsage });
    },
    convertToLlm: identityConverter,
    model: createModel(),
  };
  const { streamFn } = scripted(
    toolCallMessage([{ args: { value: "hello" }, id: "tool-1" }]),
    textMessage("done"),
  );
  const { events, messages } = yield* collect(
    agentLoop(
      [createUserMessage("echo something")],
      { messages: [], tools: [echo] },
      config,
      undefined,
      streamFn,
    ),
  );
  expect(executed).toEqual(["hello"]);
  expect(events.find((event) => event.type === "tool_execution_start")).toBeDefined();
  const toolEnd = events.find((event) => event.type === "tool_execution_end");
  expect(toolEnd?.type === "tool_execution_end" ? toolEnd.isError : undefined).toBe(false);
  expect(observedToolUsage).toEqual(toolUsage);
  const toolResult = messages.find((message) => message.role === "toolResult");
  expect(toolResult?.role === "toolResult" ? toolResult.usage : undefined).toEqual(
    patchedToolUsage,
  );
});

const recordsDuration = Effect.gen(function* () {
  const echo = tool({
    run: (_id, params) => delayed(30)(echoResult(params.value)),
  });
  const config: typesModule.AgentLoopConfig = {
    beforeToolCall: ({ toolCall }) =>
      delayed(100)(toolCall.id === "blocked" ? { block: true, reason: "no" } : undefined),
    convertToLlm: identityConverter,
    model: createModel(),
  };
  const { streamFn } = scripted(
    toolCallMessage([
      { args: { value: "a" }, id: "ran" },
      { args: { value: "b" }, id: "blocked" },
    ]),
    textMessage("done"),
  );
  const { messages } = yield* collect(
    agentLoop(
      [createUserMessage("go")],
      { messages: [], tools: [echo] },
      config,
      undefined,
      streamFn,
    ),
  );
  const [ran, blocked] = messages.filter(
    (message): message is aiTypes.ToolResultMessage => message.role === "toolResult",
  );
  expect(ran?.durationMs).toBeGreaterThanOrEqual(25);
  expect(ran?.durationMs).toBeLessThan(100);
  expect(blocked?.isError).toBe(true);
  expect(blocked).not.toHaveProperty("durationMs");
});

const skipsTruncatedToolCalls = Effect.gen(function* () {
  const executed: string[] = [];
  const echo = tool({
    run: (_id, params) => {
      executed.push(params.value);
      return Promise.resolve(echoResult(params.value));
    },
  });
  const script = scripted(
    stoppedWith("length")(toolCallMessage([{ args: { value: "hel" }, id: "tool-1" }])),
    textMessage("done"),
  );
  const { events, messages } = yield* collect(
    agentLoop(
      [createUserMessage("echo something")],
      { messages: [], tools: [echo] },
      { convertToLlm: identityConverter, model: createModel() },
      undefined,
      script.streamFn,
    ),
  );
  expect(executed).toEqual([]);
  const toolEnd = events.find((event) => event.type === "tool_execution_end");
  expect(toolEnd?.type === "tool_execution_end" ? toolEnd.isError : undefined).toBe(true);
  const text = toolEnd?.type === "tool_execution_end" ? toolEnd.result.content[0]?.text : "";
  expect(text).toContain("output token limit");
  expect(script.calls()).toBe(2);
  expect(messages.at(-1)?.role).toBe("assistant");
});

const runsMutatedArgs = Effect.gen(function* () {
  const executed: Array<string | number> = [];
  const echo = tool({
    run: (_id, params) => {
      executed.push(params.value as string | number);
      return Promise.resolve(echoResult(String(params.value)));
    },
  });
  const config: typesModule.AgentLoopConfig = {
    beforeToolCall: ({ args }) => {
      (args as { value: string | number }).value = 123;
      return Promise.resolve(undefined);
    },
    convertToLlm: identityConverter,
    model: createModel(),
  };
  const { streamFn } = scripted(
    toolCallMessage([{ args: { value: "hello" }, id: "tool-1" }]),
    textMessage("done"),
  );
  yield* collect(
    agentLoop(
      [createUserMessage("echo something")],
      { messages: [], tools: [echo] },
      config,
      undefined,
      streamFn,
    ),
  );
  expect(executed).toEqual([123]);
});

const replaceSchema = Type.Object({ newText: Type.String(), oldText: Type.String() });
const editSchema = Type.Object({ edits: Type.Array(replaceSchema) });
type Edit = { oldText: string; newText: string };

const prepareEditArguments = (args: unknown): { edits: Edit[] } => {
  const input = args as { edits?: Edit[]; oldText?: unknown; newText?: unknown };
  if (typeof input !== "object" || input === null) return args as { edits: Edit[] };
  if (typeof input.oldText !== "string" || typeof input.newText !== "string") {
    return args as { edits: Edit[] };
  }
  return { edits: [...(input.edits ?? []), { newText: input.newText, oldText: input.oldText }] };
};

const preparesArguments = Effect.gen(function* () {
  const executed: Edit[][] = [];
  const edit: typesModule.AgentTool<typeof editSchema, { count: number }> = {
    ...tool({
      name: "edit",
      parameters: editSchema,
      run: () => Promise.reject(new Error("unused")),
    }),
    execute: (_id, params) => {
      executed.push(params.edits);
      return Promise.resolve({
        content: [{ text: `edited ${params.edits.length}`, type: "text" }],
        details: { count: params.edits.length },
      });
    },
    prepareArguments: prepareEditArguments,
  };
  const { streamFn } = scripted(
    toolCallMessage([
      { args: { newText: "after", oldText: "before" }, id: "tool-1", name: "edit" },
    ]),
    textMessage("done"),
  );
  yield* collect(
    agentLoop(
      [createUserMessage("edit something")],
      { messages: [], tools: [edit] },
      { convertToLlm: identityConverter, model: createModel() },
      undefined,
      streamFn,
    ),
  );
  expect(executed).toEqual([[{ newText: "after", oldText: "before" }]]);
});

describe("agentLoop tool calls", () => {
  it("should handle tool calls and results", () => Effect.runPromise(handlesToolCalls));
  it("records how long execute() took on the tool result, excluding hooks", () =>
    Effect.runPromise(recordsDuration));
  it("should not execute tool calls from a length-truncated assistant message", () =>
    Effect.runPromise(skipsTruncatedToolCalls));
  it("should execute mutated beforeToolCall args without revalidation", () =>
    Effect.runPromise(runsMutatedArgs));
  it("should prepare tool arguments for validation", () => Effect.runPromise(preparesArguments));
});
