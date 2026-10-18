import {
  LiveDoc,
  NestedCallDoc,
  type NestedToolExecutionResult,
  type TaskId,
  type ToolHookCall,
  type ToolTaskInput,
} from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
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
import { addHooks, addTool } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

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
        written.push({ kind: write.record.kind, key: write.record.key });
    }
    return commit(writes, commitContext);
  };
  const { harness, root } = yield* openChat(storage, setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const nested = written.filter((write) => write.kind.startsWith("msa.tool."));
  expect(nested).toEqual([
    { kind: NestedCallDoc.definition.kind, key: "1" },
    { kind: NestedCallDoc.definition.kind, key: "named" },
  ]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("stores one document per nested call, keyed by its key, written only by that call", () =>
    Effect.runPromise(storesOneDocument));
});

const rejectsNestedCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  const started = deferred();
  const marked = deferred();
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
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
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
          return { output: [{ type: "text", text: `got ${text(nested)}` }] };
        }),
      ),
    ),
  );
  const { harness, root, status, entries } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(status).toBe("done");
  const [parent, child] = yield* toolTasks(harness);
  expect(nested).toEqual({
    taskId: child!.id,
    structuredOutput: "echo a",
    isError: false,
    diagnostics: [],
    durationMs: expect.any(Number),
  });
  expect(results(entries).map((result) => [result.toolCallId, text(result)])).toEqual([
    ["c1", "got echo a"],
  ]);
  expect(results(entries)[0]).not.toHaveProperty("nestedCalls");
  expect(parent!.input).toMatchObject({ kind: "model", callId: "c1" });
  expect(child!.owner).toBe(parent!.id);
  expect(child!.input as ToolTaskInput).toEqual({
    kind: "nested",
    parent: parent!.id,
    parentCallId: "c1",
    key: "1",
    call: { type: "toolCall", id: "c1/1", name: "echo", arguments: { text: "a" } },
  });
  expect(child!.state).toEqual({
    status: "terminal",
    outcome: { status: "completed", result: { kind: "nested" } },
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
      seen.push({ taskId: api.taskId, callId: api.callId });
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
