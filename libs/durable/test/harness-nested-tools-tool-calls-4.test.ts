import {
  type AgentEvent,
  LiveDoc,
  type NestedToolExecutionResult,
  type ToolTaskInput,
} from "@msa/durable";
import { ToolTask, watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { directories, toolTasks, DONE, call, tool } from "./harness-nested-tools-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addHooks,
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

function gatedLargeArgumentsBatch() {
  const setup = chatSetup();
  const hookEntered = deferred();
  const hookRelease = deferred();
  const running = deferred();
  const release = deferred();
  const large = "x".repeat(64 * 1024);
  addTool(
    setup.registry,
    tool("slow", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          running.resolve();
          yield* awaited(release.promise);
          return {};
        }),
      ),
    ),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: (hookCall) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (hookCall.parent === undefined) return undefined;
          hookEntered.resolve();
          yield* awaited(hookRelease.promise);
          return { arguments: { text: large } };
        }),
      ),
  });
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("slow", { text: "asked" }, callContext));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup, hookEntered, hookRelease, running, release, large };
}

const commitsOnlyStatus = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const running = deferred();
  const release = deferred();
  addTool(
    setup.registry,
    tool("chatty", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          api.output("line\n");
          api.diagnostic({ severity: "info", message: "note" });
          yield* awaited(api.details({ step: 1 }, callContext));
          running.resolve();
          yield* awaited(release.promise);
          return {};
        }),
      ),
    ),
  );
  let result: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          result = yield* awaited(api.executeTool("chatty", {}, callContext, { progress: false }));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* awaited(running.promise);
  const [slot] = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.nestedTools!;
  expect(slot).toEqual({
    callId: "c1/1",
    parentCallId: "c1",
    parentTaskId: expect.any(Number),
    name: "chatty",
    taskId: expect.any(Number),
    arguments: {},
    status: "running",
  });
  release.resolve();
  yield* awaited(submission.wait(context));
  expect(result).toMatchObject({
    structuredOutput: "line\n",
    details: { step: 1 },
    diagnostics: [{ severity: "info", message: "note" }],
  });
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("commits only the status of a nested call made with progress: false, and keeps its output in the result", () =>
    Effect.runPromise(commitsOnlyStatus));
});

const losesRunningOutput = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const running = deferred();
  addTool(
    setup.registry,
    tool("chatty", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          api.output("line\n");
          api.diagnostic({ severity: "info", message: "note" });
          yield* awaited(api.details({ step: 1 }, callContext));
          running.resolve();
          return yield* awaited(aborted(callContext.abortSignal!));
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          void api.executeTool("chatty", {}, callContext, { progress: false }).catch(() => {});
          yield* awaited(running.promise);
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const ends: AgentEvent[] = [];
  stream.start((batch) => {
    ends.push(...batch.filter((event) => event.type === "tool_execution_end"));

    return Promise.resolve();
  });
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  const end = ends.find(
    (event) => event.type === "tool_execution_end" && event.toolCallId === "c1/1",
  );
  const result = (end as { result?: NestedToolExecutionResult }).result!;
  expect(result).toMatchObject({ isError: true });
  expect(result).not.toHaveProperty("structuredOutput");
  expect(result).not.toHaveProperty("details");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["aborted"]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("loses the running output of a nested call made with progress: false when it is aborted", () =>
    Effect.runPromise(losesRunningOutput));
});

const showsNestedCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { setup, hookEntered, hookRelease, running, release, large } = gatedLargeArgumentsBatch();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const starts: AgentEvent[] = [];
  stream.start((batch) => {
    starts.push(...batch.filter((event) => event.type === "tool_execution_start"));

    return Promise.resolve();
  });
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  const slot = () =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.nestedTools![0]!;
      }),
    );
  yield* awaited(hookEntered.promise);
  expect(yield* awaited(slot())).toMatchObject({
    status: "pending",
    arguments: { text: "asked" },
  });
  hookRelease.resolve();
  yield* awaited(running.promise);
  expect(yield* awaited(slot())).toMatchObject({
    status: "running",
    arguments: { text: large },
  });
  release.resolve();
  yield* awaited(submission.wait(context));
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  const start = starts.find(
    (event) => event.type === "tool_execution_start" && event.toolCallId === "c1/1",
  );
  expect(start).toMatchObject({ args: { text: large } });
  const nested = (yield* toolTasks(harness)).find(
    (task) => (task.input as ToolTaskInput).kind === "nested",
  );
  expect(nested!.input as ToolTaskInput).toMatchObject({
    call: { arguments: { text: "asked" } },
  });
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("shows a nested call's arguments in its slot: as made, then, unbounded, as it runs with them", () =>
    Effect.runPromise(showsNestedCall));
});
