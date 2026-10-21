import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessStructuredEvents from "./harness-structured-events.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import type harnessStructuredSupportTypes from "./harness-structured-support.types.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { spawnAndFinish } = harnessStructuredEvents;
const {
  Node,
  OWN_CONVERSATION,
  behaviors,
  directories,
  end,
  gates,
  log,
  open,
  openNodes,
  outcomeOf,
  script,
  spawn,
  start,
  state,
  until,
  waitOn,
} = harnessStructuredSupport;
const { removeDir } = platformSupport;
const { context } = sessionSupport;

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
    resume: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          outcomes = (yield* awaited(runtime.outcomes([done, live], ctx))).map(
            (outcome) => outcome.status,
          );
          yield* awaited(runtime.commit(() => end("completed", "parent"), ctx));
        }),
      ),
    run: (runtime, ctx) => runtime.commit(() => waitOn([done, live], "allSettled"), ctx),
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

type Nodes = Effect.Success<ReturnType<typeof openNodes>>;

const expectInvalidWaitsFault = Effect.fn("expectInvalidWaitsFault")(function* (
  { harness, root }: Nodes,
  other: durableTypes.TaskId,
) {
  const cases: [
    string,
    (runtime: harnessStructuredSupportTypes.NodeRuntime) => readonly durableTypes.TaskId[],
    durableTypes.JoinPolicy,
    string,
  ][] = [
    ["self", (runtime) => [runtime.taskId], "allSettled", "is a wait cycle"],
    ["missing", () => [999_999 as durableTypes.TaskId], "allSettled", "does not exist"],
    ["foreign", () => [other], "failFast", "only on tasks it owns"],
  ];
  for (const [name, on, policy, message] of cases) {
    script(name, {
      run: (runtime, ctx) => runtime.commit(() => waitOn(on(runtime), policy), ctx),
    });
    const id = yield* awaited(start(root, name));
    expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toMatchObject({
      error: { message: expect.stringContaining(message) },
      status: "faulted",
    });
  }
});

const expectOwnerWaitCycle = Effect.fn("expectOwnerWaitCycle")(function* ({
  harness,
  root,
}: Nodes) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const ids: { child?: durableTypes.TaskId; parent?: durableTypes.TaskId } = {};
  script("child", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([ids.parent!], "allSettled"), ctx),
  });
  script("parent", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              ids.child = yield* awaited(spawn(tx, runtime.taskId, "child"));
              return waitOn([ids.child], "allSettled");
            }),
          ),
        ctx,
      ),
  });
  ids.parent = yield* awaited(start(root, "parent"));
  expect((yield* awaited(harness.waitForTask(ids.parent, context))).state.outcome.status).toBe(
    "completed",
  );
  expect((yield* awaited(harness.waitForTask(ids.child!, context))).state.outcome).toMatchObject({
    error: { message: expect.stringContaining("is a wait cycle") },
    status: "faulted",
  });
});

const rejectsWaitsItself = Effect.gen(function* () {
  const nodes = yield* openNodes();
  const other = yield* awaited(start(nodes.root, "other"));
  yield* expectInvalidWaitsFault(nodes, other);
  yield* expectOwnerWaitCycle(nodes);
  open("other");
  yield* awaited(nodes.harness.close(context));
});

describe("waiting", () => {
  it("rejects waits on itself, its owner, a missing task, and failFast on a task it does not own", () =>
    Effect.runPromise(rejectsWaitsItself));
});

const rejectsWaitCloses = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let a: durableTypes.TaskId | undefined;
  let b: durableTypes.TaskId | undefined;
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
  let held: durableTypes.TaskId | undefined;
  let other: durableTypes.TaskId | undefined;
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
  let held: durableTypes.TaskId | undefined;
  let other: durableTypes.TaskId | undefined;
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
