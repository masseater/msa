import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import type sessionSupportTypes from "./session-support.types.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { oneStep, openRoot, start } = harnessTasksSupport;
const { ControlledStorage, context, flush } = sessionSupport;
const { deferred, eventually } = taskSupport;

const sealsAdmissionSignalling = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Notes = defineDoc<{ text: string }>({
    initial: () => ({ text: "" }),
    kind: "test.close-notes",
    scope: "session",
    version: 1,
  });
  const reached = deferred();
  let fromListener: Promise<unknown> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  let watchEnd: unknown;
  const Stubborn = oneStep("test.stubborn", (_task, runtime) =>
    runPromise(
      Effect.gen(function* () {
        const watch = yield* awaited(runtime.watchDoc(Notes, context));
        runtime.signal.addEventListener("abort", () => {
          fromListener = harnessRef!.commit(() => {}, context);
        });
        reached.resolve();
        watchEnd = yield* awaited(watch!.closed);
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Stubborn]);
  harnessRef = harness;
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes))).text = "x";
          }),
        ),
      context,
    ),
  );
  yield* awaited(start(root, Stubborn));
  harness.resume();
  yield* awaited(reached.promise);
  yield* awaited(harness.close(context));
  yield* awaited(expect(fromListener).rejects.toThrow("closed"));
  expect(watchEnd).toEqual({ reason: "session_closed" });
});

describe("task close", () => {
  it("seals admission before signalling handlers and stops watches before joining them", () =>
    Effect.runPromise(sealsAdmissionSignalling));
});

const writesNoFault = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  let held: ReturnType<sessionSupportTypes.ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const Throws = oneStep("test.close-fault", (_task, runtime) => {
    held = storage.holdCommits();
    void harnessRef!.commit(
      (tx) =>
        runPromise(
          Effect.asVoid(
            Effect.suspend(() =>
              awaited(tx.appendEntry(runtime.conversationId, { kind: "blocker" })),
            ),
          ),
        ),
      context,
    );
    return Promise.reject(new Error("would fault"));
  });
  const { harness, root } = yield* openRoot([Throws], { storage });
  harnessRef = harness;
  const id = yield* awaited(start(root, Throws));
  harness.resume();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  yield* flush;
  const closing = harness.close(context);
  held!.release();
  yield* awaited(closing);
  const taskWrites = storage.commits.flatMap((writes) =>
    writes.filter((write) => write.type === "task" && write.value.id === id),
  );
  expect(
    taskWrites.map((write) => (write.type === "task" ? write.value.state.status : "")),
  ).toEqual(["pending", "running"]);
});

describe("task close", () => {
  it("writes no fault when close seals while the step after a failed phase is queued", () =>
    Effect.runPromise(writesNoFault));
});
