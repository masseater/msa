import type { Context } from "@msa/chord";
import { type AgentEvent, type Harness, LiveDoc, defineExtension, defineTask } from "@msa/durable";
import { ToolTask, watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessNestedToolsRestartSupport from "./harness-nested-tools-restart-support.ts";
import support from "./support.ts";

const {
  DONE,
  call,
  codes,
  directories,
  nestedTasks,
  restartDuring,
  results,
  spawnThroughBatch,
  sqlitePath,
  tool,
} = harnessNestedToolsRestartSupport;
const { aborted, addHooks, addTool, allEntries, awaited, chatSetup, context, deferred, removeDir } =
  support;

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

const replayUnsafeBatchStep1 = Effect.fn("replayUnsafeBatchStep1")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const runs = { gated: 0, started: 0 };
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
  return { gated, path, runPromise, running, runs, setup };
});

const replayUnsafeBatch = Effect.fn("replayUnsafeBatch")(function* () {
  const { runPromise, path, setup, runs, running, gated } = yield* replayUnsafeBatchStep1();
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
  return { gated, path, running, runs, setup };
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
  expect(runs).toEqual({ gated: 0, started: 1 });
  const [started, gate] = yield* nestedTasks(opened.harness);
  for (const task of [started, gate]) {
    expect(task).toMatchObject({
      abandonOnRestart: true,
      abortReason: "restart",
      abortRequested: true,
    });
    expect(task!.state).toMatchObject({ outcome: { status: "aborted" }, status: "terminal" });
  }
  const end = (callId: string) => ends.find((event) => event.toolCallId === callId)?.result;
  expect(codes(end("c1/1"))).toEqual(["interrupted"]);
  expect(end("c1/1")).toMatchObject({ details: { step: 1 }, isError: true });
  expect(end("c1/1")).not.toHaveProperty("structuredOutput");
  expect(codes(end("c1/2"))).toEqual(["abandoned"]);
  const [result] = results(yield* allEntries(opened.root));
  expect(result).toMatchObject({ isError: true, toolCallId: "c1" });
  expect(yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context))).toEqual({});
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("abandons a replay-unsafe caller's unfinished nested calls before they run again", () =>
    Effect.runPromise(abandonsReplayUnsafe));
});

const abandonsWorkAbandonedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const phases: string[] = [];
  const aborts: (string | undefined)[] = [];
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    abort: (task, runtime, abortContext) =>
      runPromise(
        Effect.gen(function* () {
          aborts.push(task.abortReason);
          yield* awaited(
            runtime.commit(
              () => ({ outcome: { status: "aborted" }, status: "terminal" }),
              abortContext,
            ),
          );
        }),
      ),
    initial: () => ({ phase: "work" }),
    name: "test.worker",
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
    version: 1,
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
  return { aborts, opened, phases, spawned };
});

const abandonsWorkAbandoned = Effect.gen(function* () {
  const { phases, aborts, spawned, opened } = yield* abandonsWorkAbandonedStep1;
  expect(phases).toEqual(["work"]);
  expect(aborts).toEqual(["restart"]);
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state).toMatchObject({
    outcome: { status: "aborted" },
    status: "terminal",
  });
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("abandons the work an abandoned nested call owns, which never runs a phase again", () =>
    Effect.runPromise(abandonsWorkAbandoned));
});
