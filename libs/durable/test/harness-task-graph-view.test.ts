import { defineTask } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { abortController, awaited } from "./effect-support.ts";
import { family } from "./harness-task-graph-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { completed, deferred, openTasks } from "./task-support.ts";

function gatesNever() {
  const never = new Promise<void>(() => {});
  return { child: never, late: never };
}

function memoTask() {
  const gate = deferred();
  const reached = deferred();
  const Memo = defineTask<null, { phase: "work" }, null>({
    name: "test.graph-memo",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(runtime.memo("seen", true, ctx));
            reached.resolve();
            yield* awaited(gate.promise);
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
  return { gate, reached, Memo };
}

const registersNothingAcquisition = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  yield* awaited(
    root.commit(
      (tx) =>
        tx.createTask(
          family(gatesNever()).Child,
          { late: false },
          { ownership: { kind: "conversation" } },
        ),
      context,
    ),
  );
  const held = storage.holdCommits();
  const blocking = harness.commit(
    (tx) => tx.appendEntry(root.id, { kind: "blocker" }).then(() => {}),
    context,
  );
  yield* awaited(held.entered);
  const controller = abortController();
  const cancelled = harness.watchTaskGraph({ ...context, abortSignal: controller.signal });
  controller.abort(new Error("cancelled"));
  held.release();
  yield* awaited(blocking);
  yield* awaited(expect(cancelled).rejects.toThrow("cancelled"));
  const first = yield* awaited(harness.taskGraph(context));
  const value = first.value;
  first.dispose();
  const second = yield* awaited(harness.taskGraph(context));
  expect(second.value).not.toBe(value);
  expect(second.value).toEqual(value);
  second.dispose();
  yield* awaited(harness.close(context));
});

describe("task graph view", () => {
  it("registers nothing for an acquisition cancelled while it waits for the line", () =>
    Effect.runPromise(registersNothingAcquisition));
});

const publishesNoRevision = Effect.gen(function* () {
  const { gate, reached, Memo } = memoTask();
  const { harness } = yield* openTasks(new MemoryStorage(), [Memo]);
  const root = yield* awaited(harness.root(context));
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Memo, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const first = yield* awaited(harness.taskGraph(context));
  const second = yield* awaited(harness.taskGraph(context));
  expect(second.value).toBe(first.value);
  const updates: string[] = [];
  first.subscribe((value, _context, delivery) => {
    if (delivery.kind === "update") updates.push(value.tasks[String(id)]?.state.status ?? "gone");
  });
  harness.resume();
  yield* awaited(reached.promise);
  yield* flush;
  expect(updates).toEqual(["running"]);
  gate.resolve();
  yield* awaited(harness.waitForTask(id, context));
  yield* flush;
  expect(updates).toEqual(["running", "gone"]);
  const last = first.value;
  first.dispose();
  second.dispose();
  const rebuilt = yield* awaited(harness.taskGraph(context));
  expect(rebuilt.value).toEqual(last);
  expect(rebuilt.value).not.toBe(last);
  rebuilt.dispose();
  yield* awaited(harness.close(context));
});

describe("task graph view", () => {
  it("publishes no revision for a commit that changes no node, and shares one mount between observers", () =>
    Effect.runPromise(publishesNoRevision));
});
