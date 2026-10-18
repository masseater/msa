import { defineExtension, defineTask, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, type ChatSetup, chatSetup } from "./chat-support.ts";
import { toJsonText, awaited } from "./effect-support.ts";
import {
  DONE,
  call,
  tool,
  directories,
  sqlitePath,
  results,
  nestedTasks,
  restartDuring,
} from "./harness-nested-tools-restart-support.ts";
import { addTool } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
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

function reattachingBatch(setup: ChatSetup, order: "same" | "swapped") {
  const runs: string[] = [];
  const blocked = deferred();
  const last: { seen: string[] } = { seen: [] };
  let callerRuns = 0;
  addTool(
    setup.registry,
    tool("echo", (args) => {
      runs.push(args.text ?? "");
      return Promise.resolve({ output: [{ type: "text", text: `echo ${args.text}` }] });
    }),
  );
  addTool(
    setup.registry,
    tool(
      "batch",
      (_args, api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            callerRuns++;
            const first = callerRuns === 2 && order === "swapped" ? "b" : "a";
            const one = yield* awaited(api.executeTool("echo", { text: first }, callContext));
            const named = yield* awaited(
              api.executeTool("echo", { text: "named" }, callContext, {
                key: "named",
              }),
            );
            if (callerRuns === 1) {
              blocked.resolve();
              return yield* awaited(aborted(callContext.abortSignal!));
            }
            last.seen = [one, named].map((result) => result.structuredOutput as string);
            return {};
          }),
        ),
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { runs, blocked, last };
}

const backgroundWorkSetup = Effect.fn("backgroundWorkSetup")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const started = deferred();
  const Background = defineTask<null, { phase: "work" }, null>({
    name: "test.background",
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
      runtime
        .commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), abortContext)
        .then(() => undefined),
  });
  setup.registry.install(defineExtension({ name: "background", tasks: [Background] }));
  return { path, setup, started, Background };
});

const reattachesReplaySafe = Effect.gen(function* () {
  for (const order of ["same", "swapped"] as const) {
    const path = yield* sqlitePath();
    const setup = chatSetup();
    const { runs, blocked, last } = reattachingBatch(setup, order);
    const { opened, id } = yield* restartDuring(path, setup, blocked.promise);
    opened.harness.resume();
    expect(
      (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
        .status,
    ).toBe("done");
    const [result] = results(yield* allEntries(opened.root));
    expect(runs).toEqual(["a", "named"]);
    if (order === "same") {
      expect(last.seen).toEqual(["echo a", "echo named"]);
      expect(result!.isError).toBe(false);
    } else {
      expect(result!.isError).toBe(true);
      expect(yield* toJsonText(result!.content)).toContain(
        "Nested call c1/1 was already made with another tool",
      );
    }
    yield* awaited(opened.harness.close(context));
  }
});

describe("nested tool calls across a restart", () => {
  it("reattaches a replay-safe caller by default and explicit keys, and rejects a rerun that calls differently", () =>
    Effect.runPromise(reattachesReplaySafe));
});

const abandonsChildTasksStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const phases: string[] = [];
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    name: "test.direct-worker",
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
          phases.push(`abort ${task.abortReason}`);
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              abortContext,
            ),
          );
        }),
      ),
  });
  setup.registry.install(defineExtension({ name: "direct-worker", tasks: [Worker] }));
  return { runPromise, path, setup, phases, started, Worker };
});

const abandonsChildTasks = Effect.gen(function* () {
  const { runPromise, path, setup, phases, started, Worker } = yield* abandonsChildTasksStep1;
  addTool(
    setup.registry,
    tool("work", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          const id = yield* awaited(
            api.createTask(
              Worker,
              null,
              { ownership: { kind: "task", taskId: api.taskId } },
              callContext,
            ),
          );
          yield* awaited(api.waitForTask(id, callContext));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("work"), DONE]);
  const { opened, id } = yield* restartDuring(path, setup, started.promise);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(phases).toEqual(["work", "abort restart"]);
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("abandons the child tasks a replay-unsafe tool created and awaited in memory", () =>
    Effect.runPromise(abandonsChildTasks));
});

const leavesBackgroundWork = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path, setup, started, Background } = yield* backgroundWorkSetup();
  let background: TaskId | undefined;
  addTool(
    setup.registry,
    tool("spawn", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          background = yield* awaited(
            api.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const child = yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: api.taskId },
                      }),
                    );
                    return yield* awaited(
                      tx.createTask(Background, null, {
                        conversationId: child.id,
                        ownership: { kind: "conversation" },
                        background: true,
                      }),
                    );
                  }),
                ),
              callContext,
            ),
          );
          return yield* awaited(aborted(callContext.abortSignal!));
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      api.executeTool("spawn", {}, callContext).then(() => ({})),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const { opened, id } = yield* restartDuring(path, setup, started.promise);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  const [spawn] = yield* nestedTasks(opened.harness);
  expect(spawn).toMatchObject({ abortReason: "restart", state: { status: "terminal" } });
  expect(yield* awaited(opened.harness.getTask(background!, context))).toMatchObject({
    abortRequested: false,
    state: { status: "running" },
  });
  yield* awaited(opened.harness.abortTask(background!, context));
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("leaves background work under an abandoned nested call running, and settles without it", () =>
    Effect.runPromise(leavesBackgroundWork));
});
