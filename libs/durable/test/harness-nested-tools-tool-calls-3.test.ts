import { LiveDoc, type ToolTaskInput } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
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
import {
  allEntries,
  chatSetup,
  openChat,
  awaited,
  addTool,
  removeDir,
  context,
  aborted,
  deferred,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const abortsNestedCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, echoTool().registration);
  addTool(
    setup.registry,
    tool("hang", (_args, _api, callContext) => Promise.resolve(aborted(callContext.abortSignal!))),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("echo", { text: "warm" }, callContext, { key: "warm" }));
          void api.executeTool("hang", {}, callContext, { key: "late" }).catch(() => {});
          return {};
        }),
      ),
    ),
  );
  const { harness, root, status } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(status).toBe("done");
  const late = (yield* toolTasks(harness)).find((task) => {
    const input = task.input as ToolTaskInput;
    return input.kind === "nested" && input.call.name === "hang";
  });
  expect(late!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("aborts a nested call whose admission was still committing when its caller returned", () =>
    Effect.runPromise(abortsNestedCall));
});

const abortsEveryLeft = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const bAborted = deferred();
  const started = { a: deferred(), b: deferred() };
  addTool(
    setup.registry,
    tool("a", () =>
      runPromise(
        Effect.gen(function* () {
          started.a.resolve();
          yield* awaited(bAborted.promise);
          return {};
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("b", (_args, _api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          started.b.resolve();
          yield* awaited(aborted(callContext.abortSignal!).catch(() => {}));
          bAborted.resolve();
          throw new Error("aborted");
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          void api.executeTool("a", {}, callContext, { key: "a" }).catch(() => {});
          void api.executeTool("b", {}, callContext, { key: "b" }).catch(() => {});
          yield* awaited(Promise.all([started.a.promise, started.b.promise]));
          return {};
        }),
      ),
    ),
  );
  const { harness, status } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(status).toBe("done");
  const nested = (yield* toolTasks(harness)).filter(
    (task) => (task.input as ToolTaskInput).kind === "nested",
  );
  expect(nested.map((task) => task.state.status)).toEqual(["terminal", "terminal"]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("aborts every left-running nested call before waiting for any", () =>
    Effect.runPromise(abortsEveryLeft));
});

const rejectsExplicitKeys = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, echoTool().registration);
  const errors: string[] = [];
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          for (const key of ["", "a/b", "__proto__", "7"]) {
            yield* awaited(
              api
                .executeTool("echo", {}, callContext, { key })
                .catch((error: Error) => errors.push(error.message)),
            );
          }
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  const rule = 'must be non-empty, without "/", not "__proto__", and not a positive integer';
  expect(errors).toEqual([
    `Nested call key "" ${rule}`,
    `Nested call key "a/b" ${rule}`,
    `Nested call key "__proto__" ${rule}`,
    `Nested call key "7" ${rule}`,
  ]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("rejects explicit keys that are empty, have a slash, are __proto__, or are positive integers", () =>
    Effect.runPromise(rejectsExplicitKeys));
});

const runsNestedCalls = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  addTool(
    setup.registry,
    tool("inner", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          const result = yield* awaited(
            api.executeTool("echo", { text: "deep" }, callContext, { key: "x" }),
          );
          return { output: [{ type: "text", text: text(result) }] };
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("outer", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          const result = yield* awaited(api.executeTool("inner", {}, callContext));
          return { output: [{ type: "text", text: text(result) }] };
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("outer"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const tools: (string | undefined)[][] = [];
  stream.start((batch) => {
    for (const event of batch) {
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        tools.push([event.type, event.toolCallId, event.parentToolCallId]);
      }
    }

    return Promise.resolve();
  });
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  expect(text(results(yield* allEntries(root))[0])).toBe("echo deep");
  const [outer, inner, deep] = yield* toolTasks(harness);
  expect([inner!.owner, deep!.owner]).toEqual([outer!.id, inner!.id]);
  expect(tools).toEqual([
    ["tool_execution_start", "c1", undefined],
    ["tool_execution_start", "c1/1", "c1"],
    ["tool_execution_start", "c1/1/x", "c1/1"],
    ["tool_execution_end", "c1/1/x", "c1/1"],
    ["tool_execution_end", "c1/1", "c1"],
    ["tool_execution_end", "c1", undefined],
  ]);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("runs nested calls of nested calls, and ends them children first", () =>
    Effect.runPromise(runsNestedCalls));
});
