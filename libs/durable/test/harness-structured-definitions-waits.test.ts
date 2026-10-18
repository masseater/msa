import { defineTask, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { spawnAndFinish } from "./harness-structured-events.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { addTask } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function versioned(version: 1 | 2) {
  return defineTask<
    { on: TaskId[] },
    { phase: "wait" } | { phase: "resume" } | { phase: "migrated" },
    string
  >({
    name: "test.versioned",
    version,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: (task, runtime, ctx) =>
        runtime.commit(
          () => ({
            status: "waiting",
            checkpoint: { phase: "resume" },
            on: task.input.on,
            policy: "allSettled",
          }),
          ctx,
        ),
      resume: (_task, runtime, ctx) =>
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: "v1" } }),
          ctx,
        ),
      migrated: (_task, runtime, ctx) =>
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: "v2" } }),
          ctx,
        ),
    },
    abort: (_task, runtime, ctx) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ...(version === 2
      ? {
          migrate: (input: unknown) => ({
            input: input as { on: TaskId[] },
            checkpoint: { phase: "migrated" as const },
          }),
        }
      : {}),
  });
}

const keepsWaitingTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, registry } = yield* openNodes();
  const registration = addTask(registry, versioned(1));
  const other = yield* awaited(start(root, "other"));
  const waiter = yield* awaited(
    root.commit((tx) => tx.createTask(versioned(1), { on: [other] }, OWN_CONVERSATION), context),
  );
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, waiter)).status === "waiting";
    }),
  );
  registration.dispose();
  open("other");
  yield* awaited(harness.waitForTask(other, context));
  const inspected = () =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.inspect(context))).tasks.find(
          (task) => task.record.id === waiter,
        )?.state;
      }),
    );
  expect(yield* awaited(inspected())).toEqual({ kind: "blocked", reason: "missing_task" });
  expect((yield* state(harness, waiter)).status).toBe("waiting");
  addTask(registry, versioned(2));
  expect((yield* awaited(harness.waitForTask(waiter, context))).state.outcome).toEqual({
    status: "completed",
    result: "v2",
  });
  yield* awaited(harness.close(context));
});

const orphansAbortedWaiting = Effect.gen(function* () {
  const { harness, root, registry } = yield* openNodes();
  const registration = addTask(registry, versioned(1));
  const other = yield* awaited(start(root, "other"));
  const waiter = yield* awaited(
    root.commit((tx) => tx.createTask(versioned(1), { on: [other] }, OWN_CONVERSATION), context),
  );
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, waiter)).status === "waiting";
    }),
  );
  registration.dispose();
  expect(yield* awaited(harness.abortTask(waiter, context))).toBe("marked");
  expect((yield* state(harness, waiter)).outcome).toEqual({
    status: "orphaned",
    reason: "missing_task",
  });
  expect((yield* state(harness, other)).status).toBe("running");
  open("other");
  yield* awaited(harness.close(context));
});

describe("definitions and waits", () => {
  it("keeps a waiting task blocked without its definition and resumes it migrated under a newer one", () =>
    Effect.runPromise(keepsWaitingTask));

  it("orphans an aborted waiting task without its definition at once, leaving the task it waits on running", () =>
    Effect.runPromise(orphansAbortedWaiting));
});

const neverMigratesHeldStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, registry, reports } = yield* openNodes();
  return { runPromise, harness, root, registry, reports };
});

const neverMigratesHeldStep2 = Effect.gen(function* () {
  const { runPromise, harness, root, registry, reports } = yield* neverMigratesHeldStep1;
  const holder = (version: number) =>
    defineTask<null, { phase: "run" }, string>({
      name: "test.holder",
      version,
      initial: () => ({ phase: "run" }),
      phases: {
        run: (task, runtime, ctx) =>
          runPromise(
            Effect.gen(function* () {
              const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

              yield* awaited(
                runtime.commit(
                  (tx) =>
                    runPromise(
                      Effect.gen(function* () {
                        yield* awaited(spawn(tx, task.id, "child"));
                        return undefined;
                      }),
                    ),
                  ctx,
                ),
              );
              yield* awaited(
                runtime.commit(
                  () => ({
                    status: "terminal",
                    outcome: { status: "completed", result: "held" },
                  }),
                  ctx,
                ),
              );
            }),
          ),
      },
      abort: (_task, runtime, ctx) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
      migrate: () => {
        throw new Error("never migrates");
      },
    });
  addTask(registry, holder(1));
  return { runPromise, harness, root, registry, reports, holder };
});

const neverMigratesHeld = Effect.gen(function* () {
  const { harness, root, registry, reports, holder } = yield* neverMigratesHeldStep2;
  const parent = yield* awaited(
    root.commit((tx) => tx.createTask(holder(1), null, OWN_CONVERSATION), context),
  );
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "completing";
    }),
  );
  addTask(registry, holder(2));
  open("child");
  const settledParent = yield* awaited(harness.waitForTask(parent, context));
  expect(settledParent.state.outcome).toEqual({ status: "completed", result: "held" });
  expect(settledParent.version).toBe(1);
  expect(reports).toEqual([]);
  yield* awaited(harness.close(context));
});

describe("definitions and waits", () => {
  it("never migrates a held outcome: a newer definition leaves it and its version alone", () =>
    Effect.runPromise(neverMigratesHeld));
});

const treatsHeldTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  spawnAndFinish("held", "child");
  const held = yield* awaited(start(root, "held"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, held)).status === "completing";
    }),
  );
  let rejection = "";
  script("reader", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          rejection = yield* awaited(
            runtime.outcomes([held], ctx).then(
              () => "resolved",
              (error: Error) => error.message,
            ),
          );
          yield* awaited(runtime.commit(() => waitOn([held], "allSettled"), ctx));
        }),
      ),
  });
  const reader = yield* awaited(start(root, "reader"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, reader)).status === "waiting";
    }),
  );
  expect(rejection).toBe(`Task ${held} is not terminal`);
  open("child");
  expect(yield* awaited(outcomeOf(harness, reader))).toBe("completed");
  expect(log.indexOf("resume:reader")).toBeGreaterThan(-1);
  yield* awaited(harness.close(context));
});

describe("definitions and waits", () => {
  it("treats a held task as live: outcomes() rejects, and a task waiting on it resumes at its final commit", () =>
    Effect.runPromise(treatsHeldTask));
});
