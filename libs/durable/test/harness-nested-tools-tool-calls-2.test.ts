import contextModule from "@msa/chord/context";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";

const { withAbortSignal } = contextModule;

const { MemoryStorage } = memory;
const { LiveDoc } = durable;
const { openNodeSqliteStorage } = node;

const { DONE, call, directories, echoTool, results, runOnce, text, tool, toolTasks } =
  harnessNestedToolsSupport;
const {
  abortController,
  aborted,
  addTool,
  allEntries,
  awaited,
  chatSetup,
  context,
  deferred,
  makeTempFile,
  openChat,
  removeDir,
} = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const nestedSqlitePath = Effect.fn("nestedSqlitePath")(function* () {
  const { directory, path } = yield* makeTempFile("msa-durable-nested-", "session.sqlite");
  directories.add(directory);
  return { path };
});

const abortsNestedCalls = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const running = deferred();
  addTool(
    setup.registry,
    tool("hang", (_args, _api, callContext) => {
      running.resolve();
      return Promise.resolve(aborted(callContext.abortSignal!));
    }),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("hang", {}, callContext));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(running.promise);
  yield* awaited(root.abort(context));
  expect((yield* awaited(submission.wait(context))).status).toBe("unanswered");
  const [parent, child] = yield* toolTasks(harness);
  const outcome = (record: typeof parent) =>
    record!.state.status === "terminal" ? record!.state.outcome : undefined;
  expect(outcome(child)).toMatchObject({ result: { kind: "nested" }, status: "aborted" });
  expect(outcome(parent)).toMatchObject({ result: { kind: "model" }, status: "aborted" });
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("aborts nested calls with their caller", () => Effect.runPromise(abortsNestedCalls));
});

const abortsRunningNested = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const running = deferred();
  addTool(
    setup.registry,
    tool("hang", (_args, _api, callContext) => {
      running.resolve();
      return Promise.resolve(aborted(callContext.abortSignal!));
    }),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          void api.executeTool("hang", {}, callContext).catch(() => {});
          yield* awaited(running.promise);
          throw new Error("caller failed");
        }),
      ),
    ),
  );
  const { harness, status, entries } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(status).toBe("done");
  expect(text(results(entries)[0])).toContain("caller failed");
  const [, child] = yield* toolTasks(harness);
  expect(child!.state).toMatchObject({ outcome: { status: "aborted" }, status: "terminal" });
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("aborts a running nested call when its caller throws", () =>
    Effect.runPromise(abortsRunningNested));
});

const reattachesReplaySafeStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path } = yield* nestedSqlitePath();
  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  const blocked = deferred();
  return { blocked, echo, path, runPromise, setup };
});

const reattachesReplaySafe = Effect.gen(function* () {
  const { runPromise, path, setup, echo, blocked } = yield* reattachesReplaySafeStep1;
  let runs = 0;
  addTool(
    setup.registry,
    tool(
      "batch",
      (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            runs++;
            const first = yield* awaited(api.executeTool("echo", { text: "a" }, callContext));
            if (runs === 1) {
              blocked.resolve();
              return yield* awaited(aborted(callContext.abortSignal!));
            }
            const second = yield* awaited(api.executeTool("echo", { text: "b" }, callContext));
            return {
              output: [{ text: `run ${runs}: ${text(first)}, ${text(second)}`, type: "text" }],
            };
          }),
        ),
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const id = (yield* awaited(opened.root.submit({ content: "go", type: "input" }, context))).id;
  yield* awaited(blocked.promise);
  yield* awaited(opened.harness.close(context));

  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(runs).toBe(2);
  expect(echo.state.runs).toBe(2);
  expect(text(results(yield* allEntries(opened.root))[0])).toBe("run 2: echo a, echo b");
  const tasks = yield* toolTasks(opened.harness);
  expect(
    tasks.filter((task) => (task.input as durableTypes.ToolTaskInput).kind === "nested"),
  ).toHaveLength(2);
  const outcome = tasks[1]!.state.status === "terminal" ? tasks[1]!.state.outcome : undefined;
  expect((outcome?.result as durableTypes.ToolTaskResult | undefined)?.kind).toBe("nested");
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls", () => {
  it("reattaches a replay-safe caller to the nested calls it made before a restart", () =>
    Effect.runPromise(reattachesReplaySafe));
});

const stopsOnlyWait = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const cancel = abortController();
  const release = deferred();
  const attempts: string[] = [];
  let retry: durableTypes.NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("slow", () =>
      runPromise(
        Effect.gen(function* () {
          cancel.abort(new Error("cancelled"));
          yield* awaited(release.promise);
          return { output: [{ text: "slow done", type: "text" }] };
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          const cancelled = withAbortSignal(cancel.signal, callContext);
          yield* awaited(
            api.executeTool("slow", {}, cancelled, { key: "same" }).then(
              () => attempts.push("first done"),
              () => attempts.push("first cancelled"),
            ),
          );
          release.resolve();
          retry = yield* awaited(api.executeTool("slow", {}, callContext, { key: "same" }));
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(attempts).toEqual(["first cancelled"]);
  expect(retry).toMatchObject({ isError: false, structuredOutput: "slow done" });
  expect(yield* toolTasks(harness)).toHaveLength(2);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("stops only the wait when a caller cancels it; the call runs on and its key returns its result", () =>
    Effect.runPromise(stopsOnlyWait));
});
