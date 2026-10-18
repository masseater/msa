import { type NestedToolExecutionResult, type ToolHookCall } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  directories,
  results,
  toolTasks,
  runOnce,
  text,
  DONE,
  call,
  tool,
  echoTool,
} from "./harness-nested-tools-support.ts";
import { chatSetup, awaited, addHooks, addTool, removeDir, context } from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const runsToolHooks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  const parents: ToolHookCall["parent"][] = [];
  addHooks(setup.registry, ToolTask, {
    beforeTool: (hookCall) => {
      parents.push(hookCall.parent);
      return hookCall.parent !== undefined && hookCall.arguments["text"] === "secret"
        ? { block: "no secrets" }
        : undefined;
    },
    afterTool: (hookCall, result) =>
      hookCall.parent === undefined
        ? undefined
        : { ...result, output: [{ type: "text", text: "rewritten" }] },
  });
  const nested: NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          nested.push(yield* awaited(api.executeTool("echo", { text: "secret" }, callContext)));
          nested.push(yield* awaited(api.executeTool("echo", { text: "public" }, callContext)));
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  const [parent] = yield* toolTasks(harness);
  expect(parents).toEqual([
    undefined,
    { taskId: parent!.id, callId: "c1" },
    { taskId: parent!.id, callId: "c1" },
  ]);
  expect(nested[0]).toMatchObject({
    isError: true,
    diagnostics: [{ severity: "error", code: "blocked", message: "Tool call blocked: no secrets" }],
  });
  expect(text(nested[1])).toBe("rewritten");
  expect(echo.state.runs).toBe(1);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("runs the tool hooks on nested calls, which see their parent", () =>
    Effect.runPromise(runsToolHooks));
});

const returnsErrorResult = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, echoTool().registration);
  const nested: NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          nested.push(yield* awaited(api.executeTool("missing", {}, callContext)));
          nested.push(
            yield* awaited(api.executeTool("echo", { text: { not: "a string" } }, callContext)),
          );
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(nested.map((result) => [result.isError, result.diagnostics[0]?.code])).toEqual([
    [true, "tool_unavailable"],
    [true, "invalid_arguments"],
  ]);
  yield* awaited(harness.close(context));
});

const returnsCallKey = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  let reused: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("echo", { text: "a" }, callContext, { key: "k" }));
          reused = yield* awaited(
            api.executeTool("echo", { text: "a" }, callContext, { key: "k" }),
          );
          yield* awaited(api.executeTool("echo", { text: "b" }, callContext, { key: "k" }));
          return {};
        }),
      ),
    ),
  );
  const { harness, entries } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(echo.state.runs).toBe(1);
  expect(text(reused)).toBe("echo a");
  expect(text(results(entries)[0])).toContain(
    "Nested call c1/k was already made with another tool or other arguments",
  );
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("returns an error result for an unavailable tool and invalid arguments", () =>
    Effect.runPromise(returnsErrorResult));

  it("returns the call a key already names, and rejects reusing the key for another call", () =>
    Effect.runPromise(returnsCallKey));
});
