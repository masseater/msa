import { createModels } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessTasksSupport from "./harness-tasks-support.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { Harness, createRegistry } = harnessModule;
const { defineTask } = durable;
const { MemoryStorage } = memory;

const { oneStep, openRoot, start } = harnessTasksSupport;
const { ControlledStorage, addTask, awaited, completed, context, deferred, eventually, flush } =
  support;

function sealingTask() {
  const phases: string[] = [];
  const registry = createRegistry();
  const state: {
    harnessRef?: Effect.Success<ReturnType<typeof openRoot>>["harness"];
    closing?: Promise<void>;
    closeOnSnapshot: boolean;
  } = { closeOnSnapshot: false };
  const reader: durableTypes.RegistryReader = {
    snapshot: () => {
      if (state.closeOnSnapshot) {
        state.closeOnSnapshot = false;
        state.closing = state.harnessRef!.close(context);
      }
      return registry.snapshot();
    },
    subscribe: (listener) => registry.subscribe(listener),
  };
  const Two = defineTask<null, { phase: "one" } | { phase: "two" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "one" }),
    name: "test.close-in-step",
    phases: {
      one: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            phases.push("one");
            yield* awaited(
              runtime.commit(() => ({ checkpoint: { phase: "two" }, status: "running" }), ctx),
            );
            state.closeOnSnapshot = true;
          }),
        ),
      two: () => {
        phases.push("two");

        return Promise.resolve();
      },
    },
    version: 1,
  });
  addTask(registry, Two);
  return { Two, phases, reader, state };
}

const startsNoAbort = Effect.gen(function* () {
  let ran = false;
  const Marked = oneStep(
    "test.close-abort-reservation",
    () => Promise.resolve(),
    () => {
      ran = true;

      return Promise.resolve();
    },
  );
  const storage = new ControlledStorage();
  const { harness, root } = yield* openRoot([Marked], { storage });
  const id = yield* awaited(start(root, Marked));
  expect(yield* awaited(harness.abortTask(id, context))).toBe("marked");
  const held = storage.holdCommits();
  harness.resume();
  yield* awaited(held.entered);
  const closing = harness.close(context);
  held.release();
  yield* awaited(closing);
  expect(ran).toBe(false);
  const writes = storage.commits.at(-1)!.filter((write) => write.type === "task");
  expect(writes).toMatchObject([
    { value: { abortRequested: true, id, state: { status: "running" } } },
  ]);
});

describe("task close", () => {
  it("starts no abort handler whose reservation settles while closing", () =>
    Effect.runPromise(startsNoAbort));
});

const rejectsRuntimeCommit = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  let queued: Promise<unknown> | undefined;
  let held: ReturnType<supportTypes.ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const proceed = deferred();
  const Queued = oneStep("test.close-queued-commit", (_task, runtime) =>
    runPromise(
      Effect.gen(function* () {
        const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

        held = storage.holdCommits();
        void harnessRef!.commit(
          (tx) =>
            runNested(
              Effect.asVoid(
                Effect.suspend(() =>
                  awaited(tx.appendEntry(runtime.conversationId, { kind: "blocker" })),
                ),
              ),
            ),
          context,
        );
        queued = runtime.commit(() => completed(null), context).catch((error: unknown) => error);
        yield* awaited(proceed.promise);
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Queued], { storage });
  harnessRef = harness;
  const id = yield* awaited(start(root, Queued));
  harness.resume();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  yield* flush;
  const closing = harness.close(context);
  held!.release();
  expect(String(yield* awaited(queued))).toContain("Harness is closed");
  proceed.resolve();
  yield* awaited(closing);
  const taskWrites = storage.commits.flatMap((writes) =>
    writes.filter((write) => write.type === "task" && write.value.id === id),
  );
  expect(taskWrites).toHaveLength(2);
});

describe("task close", () => {
  it("rejects a runtime commit that was queued on the line when close sealed it", () =>
    Effect.runPromise(rejectsRuntimeCommit));
});

const startsNoNext = Effect.gen(function* () {
  const { phases, state, reader, Two } = sealingTask();
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models: createModels(), registry: reader }, context),
  );
  state.harnessRef = harness;
  const root = yield* awaited(harness.root(context));
  yield* awaited(
    root.commit((tx) => tx.createTask(Two, null, { ownership: { kind: "conversation" } }), context),
  );
  harness.resume();
  yield* eventually(() => state.closing !== undefined);
  yield* awaited(state.closing);
  expect(phases).toEqual(["one"]);
});

const joinsReservationSettles = Effect.gen(function* () {
  let ran = false;
  const Never = oneStep("test.close-reservation", () => {
    ran = true;

    return Promise.resolve();
  });
  const storage = new ControlledStorage();
  const { harness, root } = yield* openRoot([Never], { storage });
  const id = yield* awaited(start(root, Never));
  const held = storage.holdCommits();
  harness.resume();
  yield* awaited(held.entered);
  const closing = harness.close(context);
  held.release();
  yield* awaited(closing);
  expect(ran).toBe(false);
  const writes = storage.commits.at(-1)!.filter((write) => write.type === "task");
  expect(writes).toMatchObject([{ type: "task", value: { id, state: { status: "running" } } }]);
});

describe("task close", () => {
  it("starts no next phase when close seals during a step that decided to continue", () =>
    Effect.runPromise(startsNoNext));

  it("joins a reservation that settles while closing without starting its handler", () =>
    Effect.runPromise(joinsReservationSettles));
});
