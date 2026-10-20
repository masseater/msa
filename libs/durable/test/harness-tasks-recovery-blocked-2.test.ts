import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessTasksRecoverySupport from "./harness-tasks-recovery-support.ts";
import support from "./support.ts";

const { defineTask } = durable;
const { createRegistry } = harnessModule;
const { MemoryStorage } = memory;

const { createIn, directories, handoverTask, startHandover } = harnessTasksRecoverySupport;
const { addTask, awaited, completed, context, deferred, eventually, flush, openTasks, removeDir } =
  support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const keepsMemosAcross = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  type Memoed = { phase: "a" } | { phase: "b" };
  const log: string[] = [];
  const gate = deferred();
  const reached = deferred();
  const memoTask = (label: string) =>
    defineTask<null, Memoed, string>({
      abort: () => Promise.resolve(),
      initial: () => ({ phase: "a" }),
      name: "test.handover-memo",
      phases: {
        a: (_task, runtime, ctx) =>
          runPromise(
            Effect.gen(function* () {
              yield* awaited(runtime.memo("picked", label, ctx));
              reached.resolve();
              yield* awaited(gate.promise);
              yield* awaited(
                runtime.commit(() => ({ checkpoint: { phase: "b" }, status: "running" }), ctx),
              );
            }),
          ),
        b: (_task, runtime, ctx) =>
          runPromise(
            Effect.gen(function* () {
              const picked = yield* awaited(runtime.memo("picked", label, ctx));
              log.push(`${label}:b ${picked}`);
              yield* awaited(runtime.commit(() => completed(picked), ctx));
            }),
          ),
      },
      version: 1,
    });
  const registry = createRegistry();
  addTask(registry, memoTask("old"));
  const { harness } = yield* openTasks(new MemoryStorage(), [], { registry });
  const id = yield* createIn(harness, memoTask("old"));
  harness.resume();
  yield* awaited(reached.promise);
  addTask(registry, memoTask("new"));
  gate.resolve();
  const receipt = yield* awaited(harness.waitForTask(id, context));
  expect(receipt.state.outcome).toEqual({ result: "old", status: "completed" });
  expect(log).toEqual(["new:b old"]);
  yield* awaited(harness.close(context));
});

describe("definition handover", () => {
  it("keeps the memos across a handover", () => Effect.runPromise(keepsMemosAcross));
});

const handsOverNewer = Effect.gen(function* () {
  const log: string[] = [];
  const gate = deferred();
  const { harness, registry, id } = yield* startHandover(log, { a: gate.promise });
  addTask(
    registry,
    handoverTask("v2", 2, log, {
      migrate: () => ({ checkpoint: { phase: "c" }, input: null }),
    }),
  );
  gate.resolve();
  const receipt = yield* awaited(harness.waitForTask(id, context));
  expect(receipt.version).toBe(2);
  expect(log).toEqual(["old:a start", "old:a end", "v2:c"]);
  yield* awaited(harness.close(context));
});

const handsOverNewerVersion = Effect.gen(function* () {
  const log: string[] = [];
  const gate = deferred();
  const { harness, registry, id, reports } = yield* startHandover(log, { a: gate.promise });
  addTask(
    registry,
    handoverTask("broken", 2, log, {
      migrate: () => {
        throw new Error("broken migration");
      },
    }),
  );
  gate.resolve();
  yield* eventually(() => reports.length === 1);
  yield* flush;
  expect(yield* awaited(harness.getTask(id, context))).toMatchObject({
    state: { checkpoint: { phase: "b" }, status: "pending" },
    version: 1,
  });
  expect(log).toEqual(["old:a start", "old:a end"]);
  yield* awaited(harness.close(context));
});

describe("definition handover", () => {
  it("hands over to a newer version with a migration", () => Effect.runPromise(handsOverNewer));

  it("hands over to a newer version whose migration fails and leaves the task blocked", () =>
    Effect.runPromise(handsOverNewerVersion));
});
