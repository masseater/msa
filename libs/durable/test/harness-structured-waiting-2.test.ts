import { type TaskId } from "@msa/durable";
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
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { deferred, settled } from "./task-support.ts";

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

const followsNoWait = Effect.gen(function* () {
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
              () => ({ status: "terminal", outcome: { status: "aborted", result: "c" } }),
              ctx,
            ),
          );
        }),
      ),
  });
  const aWaits = deferred();
  script("a", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(aWaits.promise);
          yield* awaited(runtime.commit(() => waitOn([ids["b"]!], "allSettled"), ctx));
        }),
      ),
    resume: (runtime, ctx) => runtime.commit(() => end("completed", "a"), ctx),
  });
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
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, ids["b"]!)).status === "waiting";
      }),
    ),
  );
  expect(yield* awaited(harness.abortTask(ids["b"]!, context))).toBe("marked");
  yield* until(() => log.includes("abort:c"));
  aWaits.resolve();
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, ids["a"]!)).status === "waiting";
      }),
    ),
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

const keepsRunningPhases = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const ids: TaskId[] = [];
  script("parent", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    for (const name of ["a", "b", "c"])
                      ids.push(yield* awaited(spawn(tx, runtime.taskId, name)));
                    return { status: "running", checkpoint: { phase: "resume", round: 0 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
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
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() => log.includes("round:0"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, parent)).status === "waiting";
      }),
    ),
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
