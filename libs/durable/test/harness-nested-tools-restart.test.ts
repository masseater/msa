import type { Context } from "@msa/chord";
import { type AgentEvent, defineExtension, defineTask, type Harness, LiveDoc } from "@msa/durable";
import { ToolTask, watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  spawnThroughBatch,
  DONE,
  call,
  tool,
  Parameters,
  directories,
  sqlitePath,
  results,
  codes,
  nestedTasks,
  restartDuring,
  open,
} from "./harness-nested-tools-restart-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred, eventually } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const collectEnds = Effect.fn("collectEnds")(function* (
  harness: Harness,
  conversationId: Parameters<Harness["conversation"]>[0],
) {
  const ends: Extract<AgentEvent, { type: "tool_execution_end" }>[] = [];
  const stream = yield* awaited(watchEvents(harness, conversationId, context));
  stream.start((batch) => {
    for (const event of batch) if (event.type === "tool_execution_end") ends.push(event);

    return Promise.resolve();
  });
  return { ends, stop: () => stream.stop() };
});

const replayUnsafeBatch = Effect.fn("replayUnsafeBatch")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const runs = { started: 0, gated: 0 };
  const running = deferred();
  const gated = deferred();
  addTool(
    setup.registry,
    tool(
      "started",
      (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            runs.started++;
            api.output("partial\n");
            yield* awaited(api.details({ step: 1 }, callContext));
            running.resolve();
            return yield* awaited(aborted(callContext.abortSignal!));
          }),
        ),
      { replay: "safe" },
    ),
  );
  addTool(
    setup.registry,
    tool("gated", () => {
      runs.gated++;
      return Promise.resolve({});
    }),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: (hookCall, _api, hookContext: Context) => {
      if (hookCall.name !== "gated") return Promise.resolve(undefined);
      gated.resolve();
      return Promise.resolve(aborted(hookContext.abortSignal!));
    },
  });
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          const first = api.executeTool("started", {}, callContext);
          const second = api.executeTool("gated", {}, callContext);
          yield* awaited(Promise.all([first, second]));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { path, setup, runs, running, gated };
});

const lateWorkerSetup = Effect.fn("lateWorkerSetup")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const aborts: (string | undefined)[] = [];
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    name: "test.late",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime) =>
        runPromise(
          Effect.gen(function* () {
            started.resolve();
            return yield* awaited(aborted(runtime.signal));
          }),
        ),
    },
    abort: (task, runtime, abortContext) =>
      runPromise(
        Effect.gen(function* () {
          aborts.push(task.abortReason);
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              abortContext,
            ),
          );
        }),
      ),
  });
  const extension = defineExtension({ name: "late", tasks: [Worker] });
  setup.registry.install(extension);
  return { path, setup, aborts, started, Worker, extension };
});

const abandonsReplayUnsafe = Effect.gen(function* () {
  const { path, setup, runs, running, gated } = yield* replayUnsafeBatch();
  const { opened, id } = yield* restartDuring(
    path,
    setup,
    Promise.all([running.promise, gated.promise]),
  );
  const { ends, stop } = yield* collectEnds(opened.harness, opened.root.id);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  yield* awaited(opened.harness.waitForIdle(context));
  yield* awaited(stop());
  expect(runs).toEqual({ started: 1, gated: 0 });
  const [started, gate] = yield* nestedTasks(opened.harness);
  for (const task of [started, gate]) {
    expect(task).toMatchObject({
      abandonOnRestart: true,
      abortRequested: true,
      abortReason: "restart",
    });
    expect(task!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
  }
  const end = (callId: string) => ends.find((event) => event.toolCallId === callId)?.result;
  expect(codes(end("c1/1"))).toEqual(["interrupted"]);
  expect(end("c1/1")).toMatchObject({ isError: true, details: { step: 1 } });
  expect(end("c1/1")).not.toHaveProperty("structuredOutput");
  expect(codes(end("c1/2"))).toEqual(["abandoned"]);
  const [result] = results(yield* allEntries(opened.root));
  expect(result).toMatchObject({ toolCallId: "c1", isError: true });
  expect(yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context))).toEqual({});
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("abandons a replay-unsafe caller's unfinished nested calls before they run again", () =>
    Effect.runPromise(abandonsReplayUnsafe));
});

const abandonsWorkAbandoned = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const phases: string[] = [];
  const aborts: (string | undefined)[] = [];
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    name: "test.worker",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime) =>
        runPromise(
          Effect.gen(function* () {
            phases.push("work");
            started.resolve();
            return yield* awaited(aborted(runtime.signal));
          }),
        ),
    },
    abort: (task, runtime, abortContext) =>
      runPromise(
        Effect.gen(function* () {
          aborts.push(task.abortReason);
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              abortContext,
            ),
          );
        }),
      ),
  });
  setup.registry.install(defineExtension({ name: "worker", tasks: [Worker] }));
  const spawned = spawnThroughBatch(setup, Worker);
  const { opened, id } = yield* restartDuring(path, setup, started.promise);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  yield* awaited(opened.harness.waitForIdle(context));
  expect(phases).toEqual(["work"]);
  expect(aborts).toEqual(["restart"]);
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state).toMatchObject({
    status: "terminal",
    outcome: { status: "aborted" },
  });
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("abandons the work an abandoned nested call owns, which never runs a phase again", () =>
    Effect.runPromise(abandonsWorkAbandoned));
});

const keepsAbandonedTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path, setup, aborts, started, Worker, extension } = yield* lateWorkerSetup();
  const spawned = spawnThroughBatch(setup, Worker);
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(started.promise);
  yield* awaited(opened.harness.close(context));

  setup.registry.uninstall(extension);
  opened = yield* open(path, setup);
  opened.harness.resume();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        const inspected = (yield* awaited(opened.harness.inspect(context))).tasks.find(
          (task) => task.record.id === spawned.worker,
        );
        return inspected?.state.kind === "blocked";
      }),
    ),
  );
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state.status).not.toBe(
    "terminal",
  );
  expect(aborts).toEqual([]);
  setup.registry.install(extension);
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(aborts).toEqual(["restart"]);
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state).toMatchObject({
    status: "terminal",
    outcome: { status: "aborted" },
  });
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("keeps an abandoned task whose definition is missing waiting until it is installed, then runs its abort", () =>
    Effect.runPromise(keepsAbandonedTask));
});

const orphansAbandonedTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    name: "test.gone",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime) =>
        runPromise(
          Effect.gen(function* () {
            started.resolve();
            return yield* awaited(aborted(runtime.signal));
          }),
        ),
    },
    abort: (_task, runtime, abortContext) =>
      runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ status: "terminal", outcome: { status: "aborted" } }),
                abortContext,
              ),
            ),
          ),
        ),
      ),
  });
  const extension = defineExtension({ name: "gone", tasks: [Worker] });
  setup.registry.install(extension);
  const spawned = spawnThroughBatch(setup, Worker);
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(started.promise);
  yield* awaited(opened.harness.close(context));

  setup.registry.uninstall(extension);
  opened = yield* open(path, setup);
  opened.harness.resume();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        const record = yield* awaited(opened.harness.getTask(spawned.worker!, context));
        return record?.abortReason === "restart";
      }),
    ),
  );
  yield* awaited(opened.root.abort(context));
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state).toMatchObject({
    status: "terminal",
    outcome: { status: "orphaned", reason: "missing_task" },
  });
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("unanswered");
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("orphans an abandoned task whose definition is missing once an abort is requested", () =>
    Effect.runPromise(orphansAbandonedTask));
});
