import {
  LiveDoc,
  NestedCallDoc,
  type NestedToolExecutionResult,
  type TaskId,
  type ToolTaskInput,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";

const { DONE, call, directories, echoTool, results, runOnce, text, tool, toolTasks } =
  harnessNestedToolsSupport;
const { addTool, awaited, chatSetup, context, deferred, openChat, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const storesOneDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(
            Promise.all([
              api.executeTool("echo", { text: "a" }, callContext),
              api.executeTool("echo", { text: "b" }, callContext, { key: "named" }),
            ]),
          );
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const storage = new MemoryStorage();
  const written: { kind: string; key: string | undefined }[] = [];
  const commit = storage.commit.bind(storage);
  storage.commit = (writes, commitContext) => {
    for (const write of writes) {
      if (write.type === "document.create")
        written.push({ key: write.record.key, kind: write.record.kind });
    }
    return commit(writes, commitContext);
  };
  const { harness, root } = yield* openChat(storage, setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const nested = written.filter((write) => write.kind.startsWith("msa.tool."));
  expect(nested).toEqual([
    { key: "1", kind: NestedCallDoc.definition.kind },
    { key: "named", kind: NestedCallDoc.definition.kind },
  ]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("stores one document per nested call, keyed by its key, written only by that call", () =>
    Effect.runPromise(storesOneDocument));
});

const rejectsNestedCallStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  const started = deferred();
  const marked = deferred();
  return { marked, runPromise, setup, started };
});

const rejectsNestedCall = Effect.gen(function* () {
  const { runPromise, setup, started, marked } = yield* rejectsNestedCallStep1;
  let rejected: unknown;
  let caller: TaskId | undefined;
  addTool(
    setup.registry,
    tool("late", (_args, api) =>
      runPromise(
        Effect.gen(function* () {
          caller = api.taskId;
          started.resolve();
          yield* awaited(marked.promise);
          yield* awaited(api.executeTool("echo", { text: "a" }, context)).pipe(
            Effect.catchDefect((error) =>
              Effect.sync(() => {
                rejected = error;
              }),
            ),
          );
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("late"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(started.promise);
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(caller!)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              abortRequested: true,
            });
          }),
        ),
      context,
    ),
  );
  marked.resolve();
  yield* awaited(submission.wait(context));
  expect(String(rejected)).toMatch(/abort mark|aborted|has settled/u);
  expect(yield* awaited(harness.snapshot(NestedCallDoc, caller!, "1", context))).toBeUndefined();
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("rejects a nested call of an aborted caller and leaves no document for it", () =>
    Effect.runPromise(rejectsNestedCall));
});

const runsNestedCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  let nested: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          nested = yield* awaited(api.executeTool("echo", { text: "a" }, callContext));
          return { output: [{ text: `got ${text(nested)}`, type: "text" }] };
        }),
      ),
    ),
  );
  const { harness, root, status, entries } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(status).toBe("done");
  const [parent, child] = yield* toolTasks(harness);
  expect(nested).toEqual({
    diagnostics: [],
    durationMs: expect.any(Number),
    isError: false,
    structuredOutput: "echo a",
    taskId: child!.id,
  });
  expect(results(entries).map((result) => [result.toolCallId, text(result)])).toEqual([
    ["c1", "got echo a"],
  ]);
  expect(results(entries)[0]).not.toHaveProperty("nestedCalls");
  expect(parent!.input).toMatchObject({ callId: "c1", kind: "model" });
  expect(child!.owner).toBe(parent!.id);
  expect(child!.input as ToolTaskInput).toEqual({
    call: { arguments: { text: "a" }, id: "c1/1", name: "echo", type: "toolCall" },
    key: "1",
    kind: "nested",
    parent: parent!.id,
    parentCallId: "c1",
  });
  expect(child!.state).toEqual({
    outcome: { result: { kind: "nested" }, status: "completed" },
    status: "terminal",
  });
  expect(yield* awaited(harness.snapshot(NestedCallDoc, parent!.id, "1", context))).toBeUndefined();
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("runs a nested call as its own tool task and returns its result to the caller, not the transcript", () =>
    Effect.runPromise(runsNestedCall));
});

const givesEachNested = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const seen: { taskId: TaskId; callId: string }[] = [];
  addTool(
    setup.registry,
    tool("who", (_args, api) => {
      seen.push({ callId: api.callId, taskId: api.taskId });
      return Promise.resolve({});
    }),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(
            Promise.all([
              api.executeTool("who", {}, callContext, { key: "a" }),
              api.executeTool("who", {}, callContext, { key: "b" }),
            ]),
          );
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(seen.map((each) => each.callId).sort()).toEqual(["c1/a", "c1/b"]);
  expect(new Set(seen.map((each) => each.taskId)).size).toBe(2);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("gives each nested call its own task and call ID", () => Effect.runPromise(givesEachNested));
});
