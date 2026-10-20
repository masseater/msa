import { type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const {
  Unregistered,
  behaviors,
  directories,
  end,
  gate,
  gates,
  log,
  open,
  openNodes,
  outcomeOf,
  owned,
  parentOf,
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

const heldFailureTreeStep1 = Effect.fn("heldFailureTreeStep1")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const found = { ids: [] as TaskId[] };
  script("p1", {
    resume: (runtime, ctx) => runtime.commit(() => end("failed", "p1"), ctx),
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runNested(
                  Effect.gen(function* () {
                    yield* awaited(spawn(tx, runtime.taskId, "grandchild"));
                    return { checkpoint: { phase: "resume", round: 1 }, status: "running" };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  script("grandchild", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(gate("abort.grandchild").promise);
          yield* awaited(
            runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
          );
        }),
      ),
  });
  const spawned: { outside?: TaskId } = {};
  return { found, harness, root, runPromise, spawned };
});

const heldFailureTree = Effect.fn("heldFailureTree")(function* () {
  const { runPromise, harness, root, found, spawned } = yield* heldFailureTreeStep1();
  script("parent", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              for (const name of ["p1", "p2"])
                found.ids.push(yield* awaited(spawn(tx, runtime.taskId, name)));
              spawned.outside = yield* awaited(spawn(tx, runtime.taskId, "outside"));
              return waitOn(found.ids, "failFast");
            }),
          ),
        ctx,
      ),
  });
  return { found, harness, root, spawned };
});

const resumesOnceEveryStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const found = { ids: [] as TaskId[], outcomes: [] as string[] };
  script("parent", {
    resume: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          found.outcomes = (yield* awaited(runtime.outcomes(found.ids, ctx))).map(
            (outcome) => outcome.status,
          );
          yield* awaited(runtime.commit(() => end("completed", "parent"), ctx));
        }),
      ),
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              for (const name of ["ok", "fails", "throws", "aborted"])
                found.ids.push(yield* awaited(spawn(tx, runtime.taskId, name)));
              found.ids.push(
                yield* awaited(
                  tx.createTask(Unregistered, { name: "orphan" }, owned(runtime.taskId)),
                ),
              );
              return waitOn(found.ids, "allSettled");
            }),
          ),
        ctx,
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() => found.ids.length === 5);
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "waiting";
    }),
  );
  open("ok");
  open("fails", "failed");
  return { found, harness, parent };
});

const resumesOnceEvery = Effect.gen(function* () {
  const { harness, found, parent } = yield* resumesOnceEveryStep1;
  open("throws", "throw");
  yield* awaited(harness.abortTask(found.ids[3]!, context));
  expect(yield* awaited(harness.abortTask(found.ids[4]!, context))).toBe("marked");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  expect(found.outcomes).toEqual(["completed", "failed", "faulted", "aborted", "orphaned"]);
  expect(log.filter((line) => line.startsWith("abort:"))).toEqual(["abort:aborted"]);
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("resumes once every awaited task is terminal and reads their outcomes in order (allSettled)", () =>
    Effect.runPromise(resumesOnceEvery));
});

describe("waiting", () => {
  for (const ending of ["failed", "throw"] as const) {
    it(`fails fast when a child ends ${ending === "throw" ? "faulted" : "failed"}: its live siblings are aborted, the parent is not`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { harness, root } = yield* openNodes();
          const found = parentOf("checkout", ["p1", "p2", "p3", "p4"], "failFast");
          const parent = yield* awaited(start(root, "checkout"));
          yield* until(
            Effect.gen(function* () {
              return (yield* state(harness, parent)).status === "waiting";
            }),
          );
          open("p2", ending);
          expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
          expect(found.outcomes).toEqual([
            "aborted",
            ending === "throw" ? "faulted" : "failed",
            "aborted",
            "aborted",
          ]);
          expect((yield* awaited(harness.getTask(parent, context)))!.abortRequested).toBe(false);
          expect(log.filter((line) => line.startsWith("abort:")).sort()).toEqual([
            "abort:p1",
            "abort:p3",
            "abort:p4",
          ]);
          yield* awaited(harness.close(context));
        }),
      ));
  }
});

const failsFastHeld = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, found, spawned } = yield* heldFailureTree();
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() => found.ids.length === 2);
  expect(yield* awaited(outcomeOf(harness, found.ids[1]!))).toBe("aborted");
  expect(yield* state(harness, found.ids[0]!)).toMatchObject({
    outcome: { status: "failed" },
    status: "completing",
  });
  expect((yield* state(harness, parent)).status).toBe("waiting");
  open("abort.grandchild");
  yield* until(() => log.includes("resume:parent"));
  const marked = (id: TaskId) =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.getTask(id, context)))!.abortRequested;
      }),
    );
  expect(yield* awaited(outcomeOf(harness, found.ids[0]!))).toBe("failed");
  expect([
    yield* awaited(marked(found.ids[0]!)),
    yield* awaited(marked(found.ids[1]!)),
    yield* awaited(marked(spawned.outside!)),
  ]).toEqual([false, true, false]);
  expect(yield* awaited(marked(parent))).toBe(false);
  expect((yield* state(harness, spawned.outside!)).status).toBe("running");
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "completing";
    }),
  );
  open("outside");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("fails fast on a held failure before the failing child drains", () =>
    Effect.runPromise(failsFastHeld));
});
