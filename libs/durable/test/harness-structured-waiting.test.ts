import { type JoinPolicy, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  Node,
  end,
  type NodeRuntime,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  script,
  spawnAndFinish,
  directories,
} from "./harness-structured-support.ts";
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

const waitsAllSettledTasks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const done = yield* awaited(start(root, "done"));
  open("done");
  yield* awaited(harness.waitForTask(done, context));
  const live = yield* awaited(start(root, "live"));
  let outcomes: string[] = [];
  script("parent", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([done, live], "allSettled"), ctx),
    resume: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          outcomes = (yield* awaited(runtime.outcomes([done, live], ctx))).map(
            (outcome) => outcome.status,
          );
          yield* awaited(runtime.commit(() => end("completed", "parent"), ctx));
        }),
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "waiting";
    }),
  );
  open("live", "failed");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  expect(outcomes).toEqual(["completed", "failed"]);
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("waits with allSettled on tasks it does not own, including already terminal ones", () =>
    Effect.runPromise(waitsAllSettledTasks));
});

const rejectsWaitsItself = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const other = yield* awaited(start(root, "other"));
  const cases: [string, (runtime: NodeRuntime) => readonly TaskId[], JoinPolicy, string][] = [
    ["self", (runtime) => [runtime.taskId], "allSettled", "is a wait cycle"],
    ["missing", () => [999_999 as TaskId], "allSettled", "does not exist"],
    ["foreign", () => [other], "failFast", "only on tasks it owns"],
  ];
  for (const [name, on, policy, message] of cases) {
    script(name, {
      run: (runtime, ctx) => runtime.commit(() => waitOn(on(runtime), policy), ctx),
    });
    const id = yield* awaited(start(root, name));
    expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toMatchObject({
      status: "faulted",
      error: { message: expect.stringContaining(message) },
    });
  }
  let child: TaskId | undefined;
  let parent: TaskId | undefined;
  script("child", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([parent!], "allSettled"), ctx),
  });
  script("parent", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              child = yield* awaited(spawn(tx, runtime.taskId, "child"));
              return waitOn([child], "allSettled");
            }),
          ),
        ctx,
      ),
  });
  parent = yield* awaited(start(root, "parent"));
  expect((yield* awaited(harness.waitForTask(parent, context))).state.outcome.status).toBe(
    "completed",
  );
  expect((yield* awaited(harness.waitForTask(child!, context))).state.outcome).toMatchObject({
    status: "faulted",
    error: { message: expect.stringContaining("is a wait cycle") },
  });
  open("other");
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("rejects waits on itself, its owner, a missing task, and failFast on a task it does not own", () =>
    Effect.runPromise(rejectsWaitsItself));
});

const rejectsWaitCloses = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let a: TaskId | undefined;
  let b: TaskId | undefined;
  script("a", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([b!], "allSettled"), ctx),
  });
  script("b", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([a!], "allSettled"), ctx),
  });
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            a = yield* awaited(tx.createTask(Node, { name: "a" }, OWN_CONVERSATION));
            b = yield* awaited(tx.createTask(Node, { name: "b" }, OWN_CONVERSATION));
          }),
        ),
      context,
    ),
  );
  const outcomes = yield* awaited(Promise.all([outcomeOf(harness, a!), outcomeOf(harness, b!)]));
  expect(outcomes.sort()).toEqual(["completed", "faulted"]);
  yield* awaited(harness.close(context));
});

const rejectsWaitClosesCycle = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let held: TaskId | undefined;
  let other: TaskId | undefined;
  const child = spawnAndFinish("held", "child");
  script("child", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([other!], "allSettled"), ctx),
  });
  script("other", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([held!], "allSettled"), ctx),
  });
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            held = yield* awaited(tx.createTask(Node, { name: "held" }, OWN_CONVERSATION));
            other = yield* awaited(tx.createTask(Node, { name: "other" }, OWN_CONVERSATION));
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(outcomeOf(harness, held!))).toBe("completed");
  const outcomes = yield* awaited(
    Promise.all([outcomeOf(harness, child.id!), outcomeOf(harness, other!)]),
  );
  expect(outcomes.sort()).toEqual(["completed", "faulted"]);
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("rejects the wait that closes a cycle", () => Effect.runPromise(rejectsWaitCloses));

  it("rejects the wait that closes a cycle through a held owner", () =>
    Effect.runPromise(rejectsWaitClosesCycle));
});

const rejectsCycleThrough = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let held: TaskId | undefined;
  let other: TaskId | undefined;
  const child = spawnAndFinish("held", "child");
  const grandchild = spawnAndFinish("child", "grandchild");
  script("grandchild", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([other!], "allSettled"), ctx),
  });
  script("other", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([held!], "allSettled"), ctx),
  });
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            held = yield* awaited(tx.createTask(Node, { name: "held" }, OWN_CONVERSATION));
            other = yield* awaited(tx.createTask(Node, { name: "other" }, OWN_CONVERSATION));
          }),
        ),
      context,
    ),
  );
  yield* until(() => grandchild.id !== undefined);
  const outcomes = yield* awaited(
    Promise.all([outcomeOf(harness, grandchild.id!), outcomeOf(harness, other!)]),
  );
  expect(outcomes.sort()).toEqual(["completed", "faulted"]);
  expect(yield* awaited(outcomeOf(harness, child.id!))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("rejects a cycle through holds two levels deep", () => Effect.runPromise(rejectsCycleThrough));
});
