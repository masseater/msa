import { type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
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
const { deferred, settled } = taskSupport;

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

const followsNoWaitStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const ids: Record<string, TaskId> = {};
  const cleanup = deferred();
  script("b", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              ids["c"] = yield* awaited(spawn(tx, runtime.taskId, "c"));
              return waitOn([ids["a"]!], "allSettled");
            }),
          ),
        ctx,
      ),
  });
  script("c", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(cleanup.promise);
          yield* awaited(
            runtime.commit(
              () => ({ outcome: { result: "c", status: "aborted" }, status: "terminal" }),
              ctx,
            ),
          );
        }),
      ),
  });
  const aWaits = deferred();
  script("a", {
    resume: (runtime, ctx) => runtime.commit(() => end("completed", "a"), ctx),
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(aWaits.promise);
          yield* awaited(runtime.commit(() => waitOn([ids["b"]!], "allSettled"), ctx));
        }),
      ),
  });
  return { aWaits, cleanup, harness, ids, root, runPromise };
});

const followsNoWait = Effect.gen(function* () {
  const { runPromise, harness, root, ids, cleanup, aWaits } = yield* followsNoWaitStep1;
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            ids["a"] = yield* awaited(tx.createTask(Node, { name: "a" }, OWN_CONVERSATION));
            ids["b"] = yield* awaited(tx.createTask(Node, { name: "b" }, OWN_CONVERSATION));
          }),
        ),
      context,
    ),
  );
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, ids["b"]!)).status === "waiting";
    }),
  );
  expect(yield* awaited(harness.abortTask(ids["b"]!, context))).toBe("marked");
  yield* until(() => log.includes("abort:c"));
  aWaits.resolve();
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, ids["a"]!)).status === "waiting";
    }),
  );
  cleanup.resolve();
  expect(yield* awaited(outcomeOf(harness, ids["b"]!))).toBe("aborted");
  expect(yield* awaited(outcomeOf(harness, ids["a"]!))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("follows no wait of an abort-marked task, which waits only for its owned work", () =>
    Effect.runPromise(followsNoWait));
});

const rejectsLongerCycle = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const ids: Record<string, TaskId> = {};
  const names = ["x", "y", "z"];
  for (const [index, name] of names.entries()) {
    const next = names[(index + 1) % names.length]!;
    script(name, {
      run: (runtime, ctx) => runtime.commit(() => waitOn([ids[next]!], "allSettled"), ctx),
    });
  }
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            for (const name of names)
              ids[name] = yield* awaited(tx.createTask(Node, { name }, OWN_CONVERSATION));
          }),
        ),
      context,
    ),
  );
  const outcomes = yield* awaited(Promise.all(names.map((name) => outcomeOf(harness, ids[name]!))));
  expect(outcomes.filter((outcome) => outcome === "faulted")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome === "completed")).toHaveLength(2);
  yield* awaited(harness.close(context));
});

const resumesNextPass = Effect.gen(function* () {
  const { harness, root } = yield* openNodes();
  script("parent", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([], "failFast"), ctx),
  });
  expect(yield* awaited(outcomeOf(harness, yield* awaited(start(root, "parent"))))).toBe(
    "completed",
  );
  expect(log).toEqual(["run:parent", "resume:parent"]);
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("rejects a longer cycle of waits", () => Effect.runPromise(rejectsLongerCycle));

  it("resumes at the next pass when it waits on nothing", () => Effect.runPromise(resumesNextPass));
});

const keepsRunningPhasesStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const ids: TaskId[] = [];
  script("parent", {
    resume: (runtime, ctx, round) =>
      runPromise(
        Effect.gen(function* () {
          log.push(`round:${round}`);
          if (round === 0)
            return yield* awaited(runtime.commit(() => waitOn([ids[0]!], "allSettled", 1), ctx));
          if (round === 1)
            return yield* awaited(
              runtime.commit(() => waitOn([ids[1]!, ids[2]!], "failFast", 2), ctx),
            );
          yield* awaited(runtime.commit(() => end("completed", "parent"), ctx));
        }),
      ),
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runNested(
                  Effect.gen(function* () {
                    for (const name of ["a", "b", "c"])
                      ids.push(yield* awaited(spawn(tx, runtime.taskId, name)));
                    return { checkpoint: { phase: "resume", round: 0 }, status: "running" };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() => log.includes("round:0"));
  return { harness, ids, parent, runPromise };
});

const keepsRunningPhases = Effect.gen(function* () {
  const { harness, ids, parent } = yield* keepsRunningPhasesStep1;
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "waiting";
    }),
  );
  open("b");
  expect(yield* settled(harness.waitForTask(ids[1]!, context))).toBe(true);
  expect((yield* state(harness, parent)).status).toBe("waiting");
  open("a");
  yield* until(() => log.includes("round:1"));
  open("c");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  expect(log.filter((line) => line.startsWith("round:"))).toEqual([
    "round:0",
    "round:1",
    "round:2",
  ]);
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("keeps running phases after spawning and waits on subsets in sequence", () =>
    Effect.runPromise(keepsRunningPhases));
});
