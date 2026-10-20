import type { Context } from "@msa/chord";
import { type StorageWrite, type TaskId, defineTask } from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import Dormant from "./harness-cancellation-barrier-cases.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { context, flush } = sessionSupport;
const { aborted, deferred, eventually, openTasks } = taskSupport;

class HoldMarks extends MemoryStorage {
  target: TaskId | undefined;
  readonly held = deferred();
  readonly release = deferred();
  override commit(writes: readonly StorageWrite[], commitContext: Context) {
    const superCommit = super.commit.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (
          writes.some(
            (write) =>
              write.type === "task" && write.value.id === this.target && write.value.abortRequested,
          )
        ) {
          this.held.resolve();
          yield* awaited(this.release.promise);
        }
        return yield* awaited(superCommit(writes, commitContext));
      }),
    );
  }
}

function holdingChildSetup() {
  const storage = new HoldMarks();
  const entered = deferred();
  const advance = deferred();
  const progress: { ranNext: boolean } = { ranNext: false };
  const Child = defineTask<null, { phase: "first" } | { phase: "next" }, null>({
    abort: (_task, runtime, abortContext) =>
      Effect.runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ outcome: { status: "aborted" }, status: "terminal" }),
                abortContext,
              ),
            ),
          ),
        ),
      ),
    initial: () => ({ phase: "first" }),
    name: "test.child",
    phases: {
      first: (_task, runtime, phaseContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            entered.resolve();
            yield* awaited(advance.promise);
            yield* awaited(
              runtime.commit(
                () => ({ checkpoint: { phase: "next" }, status: "running" }),
                phaseContext,
              ),
            );
          }),
        ),
      next: (_task, runtime) =>
        Effect.runPromise(
          Effect.gen(function* () {
            progress.ranNext = true;
            return yield* awaited(aborted(runtime.signal));
          }),
        ),
    },
    version: 1,
  });
  return { Child, advance, entered, progress, storage };
}

const failFastOverRestartStore = Effect.fn("failFastOverRestartStore")(function* () {
  const storage = new MemoryStorage();
  const session = createSession(storage);
  const conversation = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  const parent = yield* awaited(
    session.commit(
      (tx) =>
        tx.createTask(Dormant, null, {
          conversationId: conversation.id,
          ownership: { kind: "conversation" },
        }),
      context,
    ),
  );
  const failed = yield* awaited(
    session.commit(
      (tx) => tx.createTask(Dormant, null, { ownership: { kind: "task", taskId: parent } }),
      context,
    ),
  );
  const child = yield* awaited(
    session.commit(
      (tx) => tx.createTask(Dormant, null, { ownership: { kind: "task", taskId: parent } }),
      context,
    ),
  );
  const owner = (yield* awaited(storage.task(parent, context)))!;
  const failedRecord = (yield* awaited(storage.task(failed, context)))!;
  const waiting = {
    checkpoint: { phase: "work" },
    on: [failed, child],
    policy: "failFast",
    status: "waiting",
  } as const;
  return { child, failedRecord, owner, storage, waiting };
});

const doesNotStart = Effect.gen(function* () {
  const { storage, entered, advance, progress, Child } = holdingChildSetup();
  const { harness } = yield* openTasks(storage, [Dormant, Child]);
  const root = yield* awaited(harness.root(context));
  const parent = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Dormant, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const child = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Child, null, { ownership: { kind: "task", taskId: parent } }),
      context,
    ),
  );
  storage.target = child;
  yield* Effect.gen(function* () {
    harness.resume();
    yield* awaited(entered.promise);
    const aborting = harness.abortTask(parent, context);
    yield* awaited(storage.held.promise);
    advance.resolve();
    for (const _ of Array.from({ length: 5 })) yield* flush;
    expect(progress.ranNext).toBe(false);
    storage.release.resolve();
    expect((yield* awaited(harness.waitForTask(child, context))).state.outcome.status).toBe(
      "aborted",
    );
    yield* awaited(aborting);
    expect(progress.ranNext).toBe(false);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        advance.resolve();
        storage.release.resolve();
        yield* awaited(harness.close(context));
      }),
    ),
  );
});

describe("work below a cancelled owner", () => {
  it("does not start its next phase while the cascade that marks it has not committed", () =>
    Effect.runPromise(doesNotStart));
});

const letsFailFastRequest = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { storage, child, owner, failedRecord, waiting } = yield* failFastOverRestartStore();
  const failure = { error: { message: "failed" }, status: "failed" } as const;
  yield* awaited(
    storage.commit(
      [
        {
          type: "task",
          value: { ...owner, abortReason: "restart", abortRequested: true, state: waiting },
        },
        {
          type: "task",
          value: {
            ...failedRecord,
            state: { outcome: failure, status: "terminal" },
          } as typeof failedRecord,
        },
      ],
      context,
    ),
  );
  const { harness } = yield* openTasks(storage, []);
  yield* Effect.gen(function* () {
    harness.resume();
    yield* eventually(() =>
      runPromise(
        Effect.gen(function* () {
          return (yield* awaited(harness.getTask(child, context)))?.state.status === "terminal";
        }),
      ),
    );
    expect((yield* awaited(harness.getTask(child, context)))?.state).toMatchObject({
      outcome: { reason: "missing_task", status: "orphaned" },
    });
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(harness.close(context))))));
});

describe("work below a cancelled owner", () => {
  it("lets a failFast request in the same pass override a restart mark", () =>
    Effect.runPromise(letsFailFastRequest));
});
