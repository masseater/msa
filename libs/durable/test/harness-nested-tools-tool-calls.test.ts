import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";

const { Type } = ai;

const { LiveDoc, UsageDoc, defineTool } = durable;
const { MemoryStorage } = memory;
const { watchEvents } = harnessModule;

const { DONE, call, directories, results, runOnce, text, tool, toolTasks } =
  harnessNestedToolsSupport;
const { aborted, addTool, allEntries, awaited, chatSetup, context, deferred, openChat, removeDir } =
  support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function batchLeavingCallRunning() {
  const setup = chatSetup();
  const running = deferred();
  addTool(
    setup.registry,
    tool("hang", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          api.output("partial\n");
          yield* awaited(api.details({ step: 1 }, callContext));
          running.resolve();
          return yield* awaited(aborted(callContext.abortSignal!));
        }),
      ),
    ),
  );
  const left: { abandoned?: Promise<durableTypes.NestedToolExecutionResult> } = {};
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          left.abandoned = api.executeTool("hang", {}, callContext);
          left.abandoned.catch(() => {});
          yield* awaited(running.promise);
          return { output: [{ text: "returned early", type: "text" }] };
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup };
}

const matchesReusedKey = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  let runs = 0;
  addTool(
    setup.registry,
    defineTool({
      description: "pair",
      execute: (args) => {
        runs++;
        return Promise.resolve({ output: [{ text: `${args.a}${args.b}`, type: "text" }] });
      },
      name: "pair",
      parameters: Type.Object({ a: Type.String(), b: Type.String() }),
    }),
  );
  const nested: durableTypes.NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          nested.push(
            yield* awaited(api.executeTool("pair", { a: "x", b: "y" }, callContext, { key: "k" })),
          );
          nested.push(
            yield* awaited(api.executeTool("pair", { a: "x", b: "y" }, callContext, { key: "k" })),
          );
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(runs).toBe(1);
  expect(nested.map((result) => text(result))).toEqual(["xy", "xy"]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("matches a reused key's arguments regardless of key order", () =>
    Effect.runPromise(matchesReusedKey));
});

const abortsNestedCalls = Effect.gen(function* () {
  const { setup } = batchLeavingCallRunning();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const ends: durableTypes.AgentEvent[] = [];
  stream.start((batch) => {
    ends.push(...batch.filter((event) => event.type === "tool_execution_end"));

    return Promise.resolve();
  });
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(settled.status).toBe("done");
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  const [result] = results(yield* allEntries(root));
  expect(text(result)).toBe("returned early");
  const [, child] = yield* toolTasks(harness);
  expect(child!.state).toMatchObject({
    outcome: { result: { kind: "nested" }, status: "aborted" },
    status: "terminal",
  });
  const childEnd = ends.find(
    (event) => event.type === "tool_execution_end" && event.toolCallId === "c1/1",
  );
  expect(childEnd).toMatchObject({ result: { details: { step: 1 }, isError: true } });
  expect(
    (childEnd as { result?: durableTypes.NestedToolExecutionResult }).result,
  ).not.toHaveProperty("structuredOutput");
  expect(
    ends.map((event) => [
      event.type === "tool_execution_end" && event.toolCallId,
      "result" in event,
    ]),
  ).toEqual([
    ["c1/1", true],
    ["c1", false],
  ]);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("aborts the nested calls a caller left running when it returns, keeping their details", () =>
    Effect.runPromise(abortsNestedCalls));
});

const recordsNestedCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const usage: aiTypes.Usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0.1, output: 0.2, total: 0.3 },
    input: 1,
    output: 2,
    totalTokens: 3,
  };
  addTool(
    setup.registry,
    tool("paid", () => Promise.resolve({ usage })),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("paid", {}, callContext));
          return {};
        }),
      ),
    ),
  );
  const { harness, root } = yield* runOnce(setup, [call("batch"), DONE]);
  expect((yield* awaited(harness.snapshot(UsageDoc, root.id, context)))?.tools).toEqual({
    paid: usage,
  });
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("records a nested call's usage under its tool", () => Effect.runPromise(recordsNestedCall));
});
