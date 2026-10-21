import durable from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessTasksRecoverySupport from "./harness-tasks-recovery-support.ts";
import type harnessTasksRecoverySupportTypes from "./harness-tasks-recovery-support.types.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { defineTask } = durable;
const { openNodeSqliteStorage } = node;

const { awaited } = effectSupport;
const { createIn, directories, sqlitePath } = harnessTasksRecoverySupport;
const { removeDir } = platformSupport;
const { context, flush } = sessionSupport;
const { abortMarked, aborted, abortedWith, completed, deferred, eventually, openTasks } =
  taskSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

class TransferService {
  readonly applied = new Map<string, number>();
  calls = 0;

  apply(key: string, amount: number): Promise<number> {
    this.calls++;
    if (!this.applied.has(key)) this.applied.set(key, amount * 10);
    return Promise.resolve(this.applied.get(key)!);
  }
}

type TransferState = { phase: "prepare" } | { phase: "apply"; key: string };

function transferTask(service: TransferService, interrupt: { first: boolean }) {
  return defineTask<{ amount: number }, TransferState, { receipt: number }>({
    abort: (_task, runtime, ctx) =>
      Effect.runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
            ),
          ),
        ),
      ),
    initial: () => ({ phase: "prepare" }),
    name: "test.transfer",
    phases: {
      apply: (task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const receipt = yield* awaited(
              service.apply(task.state.checkpoint.key, task.input.amount),
            );
            if (interrupt.first) {
              interrupt.first = false;
              return yield* awaited(aborted(runtime.signal));
            }
            yield* awaited(runtime.commit(() => completed({ receipt }), ctx));
          }),
        ),
      prepare: (task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(runtime.memo("requested", task.input.amount, ctx));
            yield* awaited(
              runtime.commit(
                () => ({
                  checkpoint: { key: `transfer-${task.id}`, phase: "apply" },
                  status: "running",
                }),
                ctx,
              ),
            );
          }),
        ),
    },
    version: 1,
  });
}

const abortMarkedAtClose = Effect.fn("abortMarkedAtClose")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const log: string[] = [];
  const abortGate = { block: true };
  const abortReached = deferred();
  const runRelease = deferred();
  const Abortable = defineTask<null, harnessTasksRecoverySupportTypes.Step, null>({
    abort: (_task, runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          log.push("abort");
          if (abortGate.block) {
            abortReached.resolve();
            return yield* awaited(aborted(runtime.signal));
          }
          yield* awaited(runtime.commit(() => abortedWith("stop"), ctx));
        }),
      ),
    initial: () => ({ phase: "run" }),
    name: "test.abortable",
    phases: {
      run: () =>
        runPromise(
          Effect.gen(function* () {
            log.push("run");
            yield* awaited(runRelease.promise);
          }),
        ),
    },
    version: 1,
  });

  const opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Abortable]);
  const id = yield* createIn(opened.harness, Abortable);
  opened.harness.resume();
  yield* eventually(() => log.length === 1);
  const aborting = opened.harness.abortTask(id, context);
  yield* abortMarked(opened.harness, id);
  const closing = opened.harness.close(context);
  runRelease.resolve();
  yield* awaited(closing);
  expect(yield* awaited(aborting)).toBe("marked");
  expect(log).toEqual(["run"]);
  return { Abortable, abortGate, abortReached, id, log, path };
});

const resumesIntentEffect = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const service = new TransferService();
  const Transfer = transferTask(service, { first: true });

  const first = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Transfer]);
  const root = yield* awaited(first.harness.root(context));
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Transfer, { amount: 7 }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  first.harness.resume();
  yield* eventually(() => service.calls === 1);
  yield* awaited(first.harness.close(context));

  const second = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Transfer]);
  expect(yield* awaited(second.harness.getTask(id, context))).toMatchObject({
    abortRequested: false,
    memos: { requested: 7 },
    state: { checkpoint: { key: `transfer-${id}`, phase: "apply" }, status: "pending" },
  });
  expect(service.calls).toBe(1);
  second.harness.resume();
  const receipt = yield* awaited(second.harness.waitForTask(id, context));
  expect(receipt.state.outcome).toEqual({ result: { receipt: 70 }, status: "completed" });
  expect(service.calls).toBe(2);
  expect(service.applied.size).toBe(1);
  yield* awaited(second.harness.close(context));

  const third = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Transfer]);
  expect(yield* awaited(third.harness.getTask(id, context))).toEqual(receipt);
  yield* awaited(third.harness.close(context));
});

describe("task recovery", () => {
  it("resumes an intent/effect/outcome task interrupted after its intent across close and reopen", () =>
    Effect.runPromise(resumesIntentEffect));
});

const keepsTaskStartedAt = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const service = new TransferService();
  const Transfer = transferTask(service, { first: true });
  let clock = 2_000;
  const now = () => clock;

  const first = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Transfer], {
    now,
  });
  const root = yield* awaited(first.harness.root(context));
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Transfer, { amount: 7 }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  first.harness.resume();
  yield* eventually(() => service.calls === 1);
  clock = 3_000;
  yield* awaited(first.harness.close(context));

  clock = 9_000;
  const second = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Transfer], {
    now,
  });
  const reopened = yield* awaited(second.harness.getTask(id, context));
  expect([reopened?.state.status, reopened?.startedAt, reopened?.endedAt]).toEqual([
    "pending",
    2_000,
    undefined,
  ]);
  second.harness.resume();
  const receipt = yield* awaited(second.harness.waitForTask(id, context));
  expect([receipt.startedAt, receipt.endedAt]).toEqual([2_000, 9_000]);
  yield* awaited(second.harness.close(context));
});

describe("task recovery", () => {
  it("keeps a task's startedAt across close and reopen and stamps endedAt when it settles", () =>
    Effect.runPromise(keepsTaskStartedAt));
});

const resumesAbortWork = Effect.gen(function* () {
  const { path, log, abortGate, abortReached, Abortable, id } = yield* abortMarkedAtClose();

  const reopened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Abortable]);
  expect(yield* awaited(reopened.harness.getTask(id, context))).toMatchObject({
    abortRequested: true,
    state: { status: "pending" },
  });
  reopened.harness.resume();
  yield* awaited(abortReached.promise);
  yield* awaited(reopened.harness.close(context));
  expect(log).toEqual(["run", "abort"]);

  abortGate.block = false;
  const unblocked = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Abortable]);
  unblocked.harness.resume();
  expect((yield* awaited(unblocked.harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "stop",
    status: "aborted",
  });
  yield* awaited(unblocked.harness.close(context));
  expect(log).toEqual(["run", "abort", "abort"]);

  const settled = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Abortable]);
  settled.harness.resume();
  yield* flush;
  expect(yield* awaited(settled.harness.abortTask(id, context))).toBe("terminal");
  yield* awaited(settled.harness.close(context));
  expect(log).toEqual(["run", "abort", "abort"]);
});

describe("task recovery", () => {
  it("resumes abort work after close at every direct-task abort stage", () =>
    Effect.runPromise(resumesAbortWork));
});
