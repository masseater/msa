import type { Context } from "@msa/chord";
import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { user } from "./harness-support.ts";
import { start, oneStep, type StepRuntime, openRoot } from "./harness-tasks-support.ts";
import { context, flush } from "./session-support.ts";
import { completed } from "./task-support.ts";

function watcherTask() {
  const Notes = defineDoc<{ text: string }>({
    kind: "test.task-notes",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const seen: {
    captured?: StepRuntime<null>;
    watchClosed?: Promise<unknown>;
    absent: unknown;
    handlerContext?: Context;
  } = { absent: "unset" };
  const delivered: string[] = [];
  const Absent = defineDoc<{ text: string }>({
    kind: "test.task-absent",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const Watcher = oneStep("test.watcher", (_task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        seen.captured = runtime;
        seen.handlerContext = ctx;
        seen.absent = yield* awaited(runtime.watchDoc(Absent, ctx));
        const watch = yield* awaited(runtime.watchDoc(Notes, ctx));
        watch!.start((value) => {
          delivered.push(value?.text ?? "retired");

          return Promise.resolve();
        });
        seen.watchClosed = watch!.closed;
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  return { Notes, seen, delivered, Watcher };
}

const rejectsRuntimeOperations = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Notes, seen, delivered, Watcher } = watcherTask();
  const { harness, root } = yield* openRoot([Watcher]);
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes))).text = "hello";
          }),
        ),
      context,
    ),
  );
  const id = yield* awaited(start(root, Watcher));
  harness.resume();
  yield* awaited(harness.waitForTask(id, context));
  expect(seen.absent).toBeUndefined();
  expect(yield* awaited(seen.watchClosed)).toEqual({ reason: "stopped" });
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes))).text = "after";
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(delivered).toEqual([]);
  const runtime = seen.captured!;
  yield* awaited(expect(runtime.commit(() => {}, context)).rejects.toThrow("invocation has ended"));
  yield* awaited(expect(runtime.memo("x", context)).rejects.toThrow("invocation has ended"));
  yield* awaited(expect(runtime.memo("x", 1, context)).rejects.toThrow("invocation has ended"));
  yield* awaited(expect(runtime.sleep(0, context)).rejects.toThrow("invocation has ended"));
  yield* awaited(expect(runtime.watchDoc(Notes, context)).rejects.toThrow("invocation has ended"));
  yield* awaited(
    expect(runtime.agent(seen.handlerContext!)).rejects.toThrow("invocation has ended"),
  );
  expect(() => runtime.now()).toThrow("invocation has ended");
  expect(() => runtime.report(new Error("late"))).toThrow("invocation has ended");
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("rejects runtime operations after the invocation ends and stops its watches", () =>
    Effect.runPromise(rejectsRuntimeOperations));
});

const RuntimeNotes = defineDoc<{ text: string }>({
  kind: "test.runtime-notes",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ text: "" }),
});

const readThroughRuntime = Effect.fn("readThroughRuntime")(function* (
  runtime: StepRuntime<null>,
  ctx: Context,
) {
  const id = runtime.conversationId;
  const [first, second] = [...(yield* awaited(runtime.context(id, ctx))).entries].map(
    (entry) => entry.id,
  );
  return [
    (yield* awaited(runtime.snapshot(RuntimeNotes, id, ctx)))?.text,
    (yield* awaited(runtime.snapshotAsOf(RuntimeNotes, id, first!, ctx)))?.text,
    (yield* awaited(runtime.context(id, ctx, { at: first! }))).entries.length,
    (yield* awaited(runtime.context(id, ctx, { at: second! }))).messages.length,
  ];
});

const readsCommittedDocuments = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const seen: unknown[] = [];
  let captured: StepRuntime<null> | undefined;
  const Reader = oneStep("test.reader", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        captured = runtime;
        seen.push(...(yield* readThroughRuntime(runtime, ctx)));
        seen.push(runtime.now());
        runtime.report(new Error("reported"));
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  const { harness, root, reports } = yield* openRoot([Reader], { now: () => 1234 });
  for (const text of ["one", "two"]) {
    yield* awaited(
      root.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(RuntimeNotes, root.id))).text = text;
              yield* awaited(tx.appendEntry(root.id, { kind: "message", model: [user(text)] }));
            }),
          ),
        context,
      ),
    );
  }
  const id = yield* awaited(start(root, Reader));
  harness.resume();
  yield* awaited(harness.waitForTask(id, context));
  expect(seen).toEqual(["two", "one", 1, 2, 1234]);
  expect(reports).toEqual([new Error("reported")]);
  yield* flush;
  yield* awaited(
    expect(captured!.snapshot(RuntimeNotes, root.id, context)).rejects.toThrow(
      "invocation has ended",
    ),
  );
  yield* awaited(
    expect(captured!.context(root.id, context)).rejects.toThrow("invocation has ended"),
  );
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("reads committed documents and context through the runtime, and forwards the clock and reports", () =>
    Effect.runPromise(readsCommittedDocuments));
});
