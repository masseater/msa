import type { ToolResultMessage } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { agentLoop } from "../src/agent-loop.ts";
import type { AgentLoopConfig, AgentTool } from "../src/types.ts";
import {
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
} from "./support/fixtures.ts";

const usage = (base: number, total: number) => ({
  input: base,
  output: base + 1,
  cacheRead: base + 2,
  cacheWrite: base + 3,
  totalTokens: total,
  cost: {
    input: base / 10,
    output: (base + 1) / 10,
    cacheRead: (base + 2) / 10,
    cacheWrite: (base + 3) / 10,
    total: total / 10,
  },
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
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
    afterToolCall: ({ result }) => {
      observedToolUsage = result.usage;
      return Promise.resolve({ usage: patchedToolUsage });
    },
  };
  const { streamFn } = scripted(
    toolCallMessage([{ id: "tool-1", args: { value: "hello" } }]),
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
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
    beforeToolCall: ({ toolCall }) =>
      delayed(100)(toolCall.id === "blocked" ? { block: true, reason: "no" } : undefined),
  };
  const { streamFn } = scripted(
    toolCallMessage([
      { id: "ran", args: { value: "a" } },
      { id: "blocked", args: { value: "b" } },
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
    (message): message is ToolResultMessage => message.role === "toolResult",
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
    stoppedWith("length")(toolCallMessage([{ id: "tool-1", args: { value: "hel" } }])),
    textMessage("done"),
  );
  const { events, messages } = yield* collect(
    agentLoop(
      [createUserMessage("echo something")],
      { messages: [], tools: [echo] },
      { model: createModel(), convertToLlm: identityConverter },
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
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
    beforeToolCall: ({ args }) => {
      (args as { value: string | number }).value = 123;
      return Promise.resolve(undefined);
    },
  };
  const { streamFn } = scripted(
    toolCallMessage([{ id: "tool-1", args: { value: "hello" } }]),
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

const replaceSchema = Type.Object({ oldText: Type.String(), newText: Type.String() });
const editSchema = Type.Object({ edits: Type.Array(replaceSchema) });
type Edit = { oldText: string; newText: string };

const prepareEditArguments = (args: unknown): { edits: Edit[] } => {
  const input = args as { edits?: Edit[]; oldText?: unknown; newText?: unknown };
  if (typeof input !== "object" || input === null) return args as { edits: Edit[] };
  if (typeof input.oldText !== "string" || typeof input.newText !== "string") {
    return args as { edits: Edit[] };
  }
  return { edits: [...(input.edits ?? []), { oldText: input.oldText, newText: input.newText }] };
};

const preparesArguments = Effect.gen(function* () {
  const executed: Edit[][] = [];
  const edit: AgentTool<typeof editSchema, { count: number }> = {
    ...tool({
      name: "edit",
      parameters: editSchema,
      run: () => Promise.reject(new Error("unused")),
    }),
    prepareArguments: prepareEditArguments,
    execute: (_id, params) => {
      executed.push(params.edits);
      return Promise.resolve({
        content: [{ type: "text", text: `edited ${params.edits.length}` }],
        details: { count: params.edits.length },
      });
    },
  };
  const { streamFn } = scripted(
    toolCallMessage([
      { id: "tool-1", name: "edit", args: { oldText: "before", newText: "after" } },
    ]),
    textMessage("done"),
  );
  yield* collect(
    agentLoop(
      [createUserMessage("edit something")],
      { messages: [], tools: [edit] },
      { model: createModel(), convertToLlm: identityConverter },
      undefined,
      streamFn,
    ),
  );
  expect(executed).toEqual([[{ oldText: "before", newText: "after" }]]);
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
