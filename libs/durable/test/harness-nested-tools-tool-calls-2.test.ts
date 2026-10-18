import { withAbortSignal } from "@msa/chord/context";
import {
  LiveDoc,
  type NestedToolExecutionResult,
  type ToolTaskInput,
  type ToolTaskResult,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { abortController, awaited } from "./effect-support.ts";
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
import { addTool } from "./harness-support.ts";
import { makeTempFile, removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const interruptedCleanupBatch = Effect.fn("interruptedCleanupBatch")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-nested-", "session.sqlite");
  directories.add(directory);
  const setup = chatSetup();
  const running = deferred();
  const cleaning = deferred();
  const release = deferred();
  const counts: { hangRuns: number } = { hangRuns: 0 };
  addTool(
    setup.registry,
    tool("hang", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          counts.hangRuns++;
          api.output("partial\n");
          yield* awaited(api.details({ step: 1 }, callContext));
          running.resolve();
          yield* awaited(aborted(callContext.abortSignal!).catch(() => {}));
          cleaning.resolve();
          yield* awaited(release.promise);
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
          void api.executeTool("hang", {}, callContext).catch(() => {});
          yield* awaited(running.promise);
          return { output: [{ type: "text", text: "returned early" }] };
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { path, setup, cleaning, release, counts };
});

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
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* awaited(running.promise);
  yield* awaited(root.abort(context));
  expect((yield* awaited(submission.wait(context))).status).toBe("unanswered");
  const [parent, child] = yield* toolTasks(harness);
  const outcome = (record: typeof parent) =>
    record!.state.status === "terminal" ? record!.state.outcome : undefined;
  expect(outcome(child)).toMatchObject({ status: "aborted", result: { kind: "nested" } });
  expect(outcome(parent)).toMatchObject({ status: "aborted", result: { kind: "model" } });
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
  expect(child!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("aborts a running nested call when its caller throws", () =>
    Effect.runPromise(abortsRunningNested));
});

const reattachesReplaySafe = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path } = yield* nestedSqlitePath();
  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  const blocked = deferred();
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
              output: [{ type: "text", text: `run ${runs}: ${text(first)}, ${text(second)}` }],
            };
          }),
        ),
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
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
  expect(tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested")).toHaveLength(2);
  const outcome = tasks[1]!.state.status === "terminal" ? tasks[1]!.state.outcome : undefined;
  expect((outcome?.result as ToolTaskResult | undefined)?.kind).toBe("nested");
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
  let retry: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("slow", () =>
      runPromise(
        Effect.gen(function* () {
          cancel.abort(new Error("cancelled"));
          yield* awaited(release.promise);
          return { output: [{ type: "text", text: "slow done" }] };
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

const admitsOneNested = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  let both: NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          both = yield* awaited(
            Promise.all([
              api.executeTool("echo", { text: "a" }, callContext, { key: "k" }),
              api.executeTool("echo", { text: "a" }, callContext, { key: "k" }),
            ]),
          );
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(echo.state.runs).toBe(1);
  expect(both.map((result) => text(result))).toEqual(["echo a", "echo a"]);
  expect(yield* toolTasks(harness)).toHaveLength(2);
  yield* awaited(harness.close(context));
});

const abortsLeftRunning = Effect.gen(function* () {
  const { path, setup, cleaning, release, counts } = yield* interruptedCleanupBatch();
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(cleaning.promise);
  const closed = opened.harness.close(context);
  release.resolve();
  yield* awaited(closed);

  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  yield* awaited(opened.harness.waitForIdle(context));
  const [result] = results(yield* allEntries(opened.root));
  expect(result).toMatchObject({ toolCallId: "c1", isError: true });
  expect(text(result)).toContain("Tool batch was interrupted");
  const [, child] = yield* toolTasks(opened.harness);
  expect(child!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
  expect(counts.hangRuns).toBe(1);
  expect(yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context))).toEqual({});
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls", () => {
  it("admits one nested call for a key used by concurrent calls", () =>
    Effect.runPromise(admitsOneNested));

  it("aborts left-running nested calls of a caller interrupted while it cleaned them up", () =>
    Effect.runPromise(abortsLeftRunning));
});
