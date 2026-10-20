import { type Conversation, defineTask } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessContextSupport from "./harness-context-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { ABORTED, DONE, countingSetup, probeTask } = harnessContextSupport;
const { addTask, user } = harnessSupport;
const { context } = sessionSupport;

afterEach(() => {
  vi.useRealTimers();
});

type Read = Parameters<typeof probeTask>[0];

function childReadTask(root: Conversation, read: Read) {
  return defineTask<Record<string, never>, { phase: "run" }, null>({
    abort: (_task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => ABORTED, taskContext)))),
      ),
    initial: () => ({ phase: "run" }),
    name: "test.context-child",
    phases: {
      run: (_task, runtime, taskContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(
              runtime.commit(
                (tx) =>
                  tx
                    .appendEntry(root.id, { kind: "message", model: [user("from child")] })
                    .then(() => undefined),
                taskContext,
              ),
            );
            yield* awaited(read("child", () => runtime.context(root.id, taskContext), taskContext));
            yield* awaited(runtime.commit(() => DONE, taskContext));
          }),
        ),
    },
    version: 1,
  });
}

function parentReadTask(root: Conversation, read: Read, Child: ReturnType<typeof childReadTask>) {
  return defineTask<Record<string, never>, { phase: "start" } | { phase: "after" }, null>({
    abort: (_task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => ABORTED, taskContext)))),
      ),
    initial: () => ({ phase: "start" }),
    name: "test.context-parent",
    phases: {
      after: (_task, runtime, taskContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(read("after", () => runtime.context(root.id, taskContext), taskContext));
            yield* awaited(runtime.commit(() => DONE, taskContext));
          }),
        ),
      start: (_task, runtime, taskContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(
              read("parent", () => runtime.context(root.id, taskContext), taskContext),
            );
            yield* awaited(
              runtime.commit(
                (tx) =>
                  tx
                    .createTask(
                      Child,
                      {},
                      {
                        conversationId: root.id,
                        ownership: { kind: "task", taskId: runtime.taskId },
                      },
                    )
                    .then((child) => ({
                      checkpoint: { phase: "after" },
                      on: [child],
                      policy: "allSettled",
                      status: "waiting",
                    })),
                taskContext,
              ),
            );
          }),
        ),
    },
    version: 1,
  });
}

const keepsConversationContext = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let clock = 1_000;
  const { harness, registry, root, scanned } = yield* countingSetup({ now: () => clock });
  const rows: Record<string, number> = {};
  const read: Read = (name, load, taskContext) =>
    runPromise(
      Effect.gen(function* () {
        const before = scanned.rows;
        const view = yield* awaited(load());
        rows[name] = scanned.rows - before;
        expect(view).toEqual(yield* awaited(root.context(taskContext)));
      }),
    );
  const Child = childReadTask(root, read);
  const Parent = parentReadTask(root, read, Child);
  const Probe = probeTask(read);
  for (const task of [Child, Parent, Probe]) addTask(registry, task);
  harness.resume();
  const options = { conversationId: root.id, ownership: { kind: "conversation" } } as const;
  const parent = yield* awaited(
    harness.commit((tx) => tx.createTask(Parent, {}, options), context),
  );
  expect((yield* awaited(harness.waitForTask(parent, context))).state.outcome).toEqual(
    DONE.outcome,
  );
  yield* awaited(root.waitForIdle(context));
  const probe = (name: string) =>
    runPromise(
      Effect.gen(function* () {
        const id = yield* awaited(
          harness.commit((tx) => tx.createTask(Probe, { name }, options), context),
        );
        expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual(
          DONE.outcome,
        );
        yield* awaited(root.waitForIdle(context));
      }),
    );
  yield* awaited(probe("idle"));
  clock += 600_000;
  yield* awaited(probe("expired"));
  expect(rows).toEqual({ after: 1, child: 2, expired: 23, idle: 1, parent: 22 });
  yield* awaited(harness.close(context));
});

describe("conversation context", () => {
  it("keeps a conversation's context read across its tasks and for the retention period once idle", () =>
    Effect.runPromise(keepsConversationContext));
});
