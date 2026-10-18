import type { AgentTool, AgentToolCall } from "@msa/agent-core";
import type { Usage } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import {
  NESTED_CALL_LIMITS,
  NestedCallRecorder,
  type NestedToolCallHost,
  NestedToolCallRunner,
  type NestedToolExecutionEvent,
} from "../src/core/nested-tool-calls.ts";

function usage(input: number, cost: number): Usage {
  return {
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function createRunner(tools: AgentTool[], options: { sequential?: boolean } = {}) {
  const events: NestedToolExecutionEvent[] = [];
  const host: NestedToolCallHost = {
    getTools: () => tools,
    isSequential: () => options.sequential ?? false,
    runToolCall: (toolCall, _parentId, signal, onUpdate) =>
      runTest(
        Effect.gen(function* () {
          const tool = tools.find((candidate) => candidate.name === toolCall.name);
          if (!tool) {
            return yield* awaited({
              toolCall,
              result: {
                content: [{ type: "text" as const, text: `Tool ${toolCall.name} not found` }],
                details: {},
              },
              isError: true,
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
          return yield* awaited({ toolCall, result, isError: result.isError === true });
        }),
      ),
    emit: (event) =>
      runTest(
        Effect.sync(() => {
          events.push(event);
        }),
      ),
  };
  return { runner: new NestedToolCallRunner(host), events };
}

describe("NestedToolCallRunner", () => {
  it("assigns ids below the caller, emits events with the parent id, and records the calls", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const echo: AgentTool = {
          name: "echo",
          label: "Echo",
          description: "Echo",
          parameters: Type.Object({}),
          execute(_id, _params, _signal, onUpdate) {
            return effectRunPromise(
              Effect.gen(function* () {
                onUpdate?.({ content: [{ type: "text" as const, text: "partial" }], details: {} });
                return yield* awaited({
                  content: [{ type: "text" as const, text: "ok" }],
                  details: {},
                });
              }),
            );
          },
        };
        const { runner, events } = createRunner([echo]);
        const updates: unknown[] = [];

        const first = yield* awaited(
          runner.execute(
            "call",
            "echo",
            { a: 1 },
            { onUpdate: (partial) => updates.push(partial) },
          ),
        );
        const missing = yield* awaited(runner.execute("call", "missing", {}));

        expect(first.toolCall.id).toBe("call/1");
        expect(missing).toMatchObject({ toolCall: { id: "call/2" }, isError: true });
        expect(updates).toHaveLength(1);
        expect(
          events.map((event) => [event.type, event.toolCallId, event.parentToolCallId]),
        ).toEqual([
          ["tool_execution_start", "call/1", "call"],
          ["tool_execution_update", "call/1", "call"],
          ["tool_execution_end", "call/1", "call"],
          ["tool_execution_start", "call/2", "call"],
          ["tool_execution_end", "call/2", "call"],
        ]);
        expect(runner.takeRecord("call")?.calls).toEqual({
          calls: [
            {
              id: "call/1",
              name: "echo",
              arguments: { a: 1 },
              status: "ok",
              durationMs: expect.any(Number),
            },
            {
              id: "call/2",
              name: "missing",
              arguments: {},
              status: "error",
              durationMs: expect.any(Number),
              error: "Tool missing not found",
            },
          ],
          complete: true,
        });

        expect(runner.takeRecord("call")).toBeUndefined();
        expect(runner.takeRecord("other")).toBeUndefined();
      }),
    ));

  it("records calls of nested tools on the model-issued call", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const leaf: AgentTool = {
          name: "leaf",
          label: "Leaf",
          description: "Leaf",
          parameters: Type.Object({}),
          execute() {
            return effectRunPromise(awaited({ content: [], details: {} }));
          },
        };
        const tools: AgentTool[] = [leaf];
        const { runner } = createRunner(tools);
        tools.push({
          name: "middle",
          label: "Middle",
          description: "Calls leaf",
          parameters: Type.Object({}),
          execute(toolCallId) {
            return effectRunPromise(
              Effect.gen(function* () {
                yield* awaited(runner.execute(toolCallId, "leaf", {}));
                return yield* awaited({ content: [], details: {} });
              }),
            );
          },
        });

        yield* awaited(runner.execute("call", "middle", {}));

        expect(runner.takeRecord("call")?.calls?.calls.map((call) => call.id)).toEqual([
          "call/1",
          "call/1/1",
        ]);
      }),
    ));

  it("sums the usage of nested results at every depth", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const leaf: AgentTool = {
          name: "leaf",
          label: "Leaf",
          description: "Leaf",
          parameters: Type.Object({}),
          execute() {
            return effectRunPromise(awaited({ content: [], details: {}, usage: usage(10, 0.01) }));
          },
        };
        const plain: AgentTool = {
          ...leaf,
          name: "plain",
          execute: () => effectRunPromise(awaited({ content: [], details: {} })),
        };
        const tools: AgentTool[] = [leaf, plain];
        const { runner } = createRunner(tools);
        tools.push({
          name: "middle",
          label: "Middle",
          description: "Calls leaf",
          parameters: Type.Object({}),
          execute(toolCallId) {
            return effectRunPromise(
              Effect.gen(function* () {
                yield* awaited(runner.execute(toolCallId, "leaf", {}));

                return yield* awaited({ content: [], details: {}, usage: usage(5, 0.005) });
              }),
            );
          },
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
      }),
    ));

  it("serializes concurrent calls to sequential tools", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let active = 0;
        let maxActive = { sequential: 0, parallel: 0 };
        const makeTool = (name: "sequential" | "parallel"): AgentTool => ({
          name,
          label: name,
          description: name,
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

        expect(maxActive).toEqual({ sequential: 1, parallel: 3 });
      }),
    ));
});

describe("NestedCallRecorder", () => {
  const call = (id: string, args: AgentToolCall["arguments"]): AgentToolCall => ({
    type: "toolCall" as const,
    id,
    name: "t",
    arguments: args,
  });

  it("omits oversized arguments and drops calls beyond the limit", () => {
    const recorder = new NestedCallRecorder();
    expect(recorder.snapshot()).toBeUndefined();
    const small = recorder.start(call("a", { x: 1 }));
    recorder.finish(small, false, "");
    expect(recorder.snapshot()).toEqual({
      calls: [
        { id: "a", name: "t", arguments: { x: 1 }, status: "ok", durationMs: expect.any(Number) },
      ],
      complete: true,
    });

    const big = recorder.start(
      call("b", { text: "x".repeat(NESTED_CALL_LIMITS.maxArgumentBytesPerCall) }),
    );
    recorder.finish(big, true, "e".repeat(1000));
    const snapshot = recorder.snapshot();
    expect(snapshot?.complete).toBe(false);
    expect(snapshot?.calls[1]).toMatchObject({ id: "b", status: "error" });
    expect(snapshot?.calls[1]?.arguments).toBeUndefined();
    expect(snapshot?.calls[1]?.argumentsBytes).toBeGreaterThan(
      NESTED_CALL_LIMITS.maxArgumentBytesPerCall,
    );
    expect(snapshot?.calls[1]?.error).toHaveLength(NESTED_CALL_LIMITS.maxErrorChars);

    for (let i = 0; i < NESTED_CALL_LIMITS.maxCalls; i++)
      recorder.finish(recorder.start(call(`c${i}`, {})), false, "");
    expect(recorder.snapshot()?.calls).toHaveLength(NESTED_CALL_LIMITS.maxCalls);
  });

  it("caps the total argument size and marks unfinished calls incomplete", () => {
    const recorder = new NestedCallRecorder();
    const chunk = { text: "x".repeat(7000) };
    const records = Array.from({ length: 6 }, (_, i) => recorder.start(call(`c${i}`, chunk)));
    const snapshot = recorder.snapshot();

    expect(snapshot?.calls.filter((entry) => entry.arguments !== undefined)).toHaveLength(4);
    expect(snapshot?.calls.every((entry) => entry.status === "unfinished")).toBe(true);
    expect(snapshot?.complete).toBe(false);
    expect(records).toHaveLength(6);
  });
});
