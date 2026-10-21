import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import NestedToolCallRunner from "../src/core/nested-tool-call-runner.ts";
import type nestedToolCallsTypes from "../src/core/nested-tool-calls.types.ts";
const { awaited, runTest } = testing;

function usage(input: number, cost: number): aiTypes.Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: cost, output: 0, total: cost },
    input,
    output: 0,
    totalTokens: input,
  };
}

function createRunner(tools: agentTypes.AgentTool[], options: { sequential?: boolean } = {}) {
  const events: nestedToolCallsTypes.NestedToolExecutionEvent[] = [];
  const host: nestedToolCallsTypes.NestedToolCallHost = {
    emit: (event) =>
      runTest(
        Effect.sync(() => {
          events.push(event);
        }),
      ),
    getTools: () => tools,
    isSequential: () => options.sequential ?? false,
    runToolCall: (toolCall, _parentId, signal, onUpdate) =>
      runTest(
        Effect.gen(function* () {
          const tool = tools.find((candidate) => candidate.name === toolCall.name);
          if (!(tool !== undefined)) {
            return yield* awaited({
              isError: true,
              result: {
                content: [{ text: `Tool ${toolCall.name} not found`, type: "text" as const }],
                details: {},
              },
              toolCall,
            });
          }
          const result = yield* awaited(
            tool.execute(
              toolCall.id,
              toolCall.arguments,
              signal,
              (partial) => void onUpdate(partial),
            ),
          );
          return yield* awaited({ isError: result.isError === true, result, toolCall });
        }),
      ),
  };
  return { events, runner: new NestedToolCallRunner(host) };
}

const assignsIdsBelowTheCallerEmitsEventsSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const echo: agentTypes.AgentTool = {
      description: "Echo",
      execute(_id, _params, _signal, onUpdate) {
        return effectRunPromise(
          Effect.gen(function* () {
            onUpdate?.({ content: [{ text: "partial", type: "text" as const }], details: {} });
            return yield* awaited({
              content: [{ text: "ok", type: "text" as const }],
              details: {},
            });
          }),
        );
      },
      label: "Echo",
      name: "echo",
      parameters: Type.Object({}),
    };
    return { echo };
  });

const assignsIdsBelowTheCallerEmitsEvents = Effect.gen(function* () {
  const { echo } = yield* assignsIdsBelowTheCallerEmitsEventsSetup();
  const { runner, events } = createRunner([echo]);
  const updates: unknown[] = [];

  const first = yield* awaited(
    runner.execute("call", "echo", { a: 1 }, { onUpdate: (partial) => updates.push(partial) }),
  );
  const missing = yield* awaited(runner.execute("call", "missing", {}));

  expect(first.toolCall.id).toBe("call/1");
  expect(missing).toMatchObject({ isError: true, toolCall: { id: "call/2" } });
  expect(updates).toHaveLength(1);
  expect(events.map((event) => [event.type, event.toolCallId, event.parentToolCallId])).toEqual([
    ["tool_execution_start", "call/1", "call"],
    ["tool_execution_update", "call/1", "call"],
    ["tool_execution_end", "call/1", "call"],
    ["tool_execution_start", "call/2", "call"],
    ["tool_execution_end", "call/2", "call"],
  ]);
  expect(runner.takeRecord("call")?.calls).toEqual({
    calls: [
      {
        arguments: { a: 1 },
        durationMs: expect.any(Number),
        id: "call/1",
        name: "echo",
        status: "ok",
      },
      {
        arguments: {},
        durationMs: expect.any(Number),
        error: "Tool missing not found",
        id: "call/2",
        name: "missing",
        status: "error",
      },
    ],
    complete: true,
  });

  expect(runner.takeRecord("call")).toBeUndefined();
  expect(runner.takeRecord("other")).toBeUndefined();
});

const recordsCallsOfNestedToolsOnThe = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const leaf: agentTypes.AgentTool = {
    description: "Leaf",
    execute() {
      return effectRunPromise(awaited({ content: [], details: {} }));
    },
    label: "Leaf",
    name: "leaf",
    parameters: Type.Object({}),
  };
  const tools: agentTypes.AgentTool[] = [leaf];
  const { runner } = createRunner(tools);
  tools.push({
    description: "Calls leaf",
    execute(toolCallId) {
      return effectRunPromise(
        Effect.gen(function* () {
          yield* awaited(runner.execute(toolCallId, "leaf", {}));
          return yield* awaited({ content: [], details: {} });
        }),
      );
    },
    label: "Middle",
    name: "middle",
    parameters: Type.Object({}),
  });

  yield* awaited(runner.execute("call", "middle", {}));

  expect(runner.takeRecord("call")?.calls?.calls.map((call) => call.id)).toEqual([
    "call/1",
    "call/1/1",
  ]);
});

const sumsTheUsageOfNestedResultsAt = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const leaf: agentTypes.AgentTool = {
    description: "Leaf",
    execute() {
      return effectRunPromise(awaited({ content: [], details: {}, usage: usage(10, 0.01) }));
    },
    label: "Leaf",
    name: "leaf",
    parameters: Type.Object({}),
  };
  const plain: agentTypes.AgentTool = {
    ...leaf,
    execute: () => effectRunPromise(awaited({ content: [], details: {} })),
    name: "plain",
  };
  const tools: agentTypes.AgentTool[] = [leaf, plain];
  const { runner } = createRunner(tools);
  tools.push({
    description: "Calls leaf",
    execute(toolCallId) {
      return effectRunPromise(
        Effect.gen(function* () {
          yield* awaited(runner.execute(toolCallId, "leaf", {}));

          return yield* awaited({ content: [], details: {}, usage: usage(5, 0.005) });
        }),
      );
    },
    label: "Middle",
    name: "middle",
    parameters: Type.Object({}),
  });

  yield* awaited(runner.execute("call", "middle", {}));
  yield* awaited(runner.execute("call", "leaf", {}));
  yield* awaited(runner.execute("call", "plain", {}));
  yield* awaited(runner.execute("free", "plain", {}));

  const summary = runner.takeRecord("call");
  expect(summary?.usage?.input).toBe(25);
  expect(summary?.usage?.cost.total).toBeCloseTo(0.025, 10);
  expect(runner.takeRecord("free")).toMatchObject({
    calls: { complete: true },
    usage: undefined,
  });
});

const serializesConcurrentCallsToSequentialTools = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let active = 0;
  let maxActive = { parallel: 0, sequential: 0 };
  const makeTool = (name: "sequential" | "parallel"): agentTypes.AgentTool => ({
    description: name,
    label: name,
    name,
    parameters: Type.Object({}),
    ...(name === "sequential" ? { executionMode: "sequential" as const } : {}),
    execute() {
      return effectRunPromise(
        Effect.gen(function* () {
          active++;
          maxActive = { ...maxActive, [name]: Math.max(maxActive[name], active) };
          yield* Effect.sleep(5);
          active--;
          return yield* awaited({ content: [], details: {} });
        }),
      );
    },
  });
  const { runner } = createRunner([makeTool("sequential"), makeTool("parallel")]);

  yield* awaited(Promise.all([1, 2, 3].map(() => runner.execute("call", "sequential", {}))));
  yield* awaited(Promise.all([1, 2, 3].map(() => runner.execute("call", "parallel", {}))));

  expect(maxActive).toEqual({ parallel: 3, sequential: 1 });
});

describe("NestedToolCallRunner", () => {
  it("assigns ids below the caller, emits events with the parent id, and records the calls", () =>
    runTest(assignsIdsBelowTheCallerEmitsEvents));

  it("records calls of nested tools on the model-issued call", () =>
    runTest(recordsCallsOfNestedToolsOnThe));

  it("sums the usage of nested results at every depth", () =>
    runTest(sumsTheUsageOfNestedResultsAt));

  it("serializes concurrent calls to sequential tools", () =>
    runTest(serializesConcurrentCallsToSequentialTools));
});
