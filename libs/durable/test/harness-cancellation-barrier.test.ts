import type { Context } from "@msa/chord";
import { defineTask, type StorageWrite, type TaskId } from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, flush } from "./session-support.ts";
import { aborted, deferred, eventually, openTasks } from "./task-support.ts";

const Dormant = defineTask<null, { phase: "work" }, null>({
  name: "test.dormant",
  version: 1,
  initial: () => ({ phase: "work" }),
  phases: {
    work: (_task, runtime) =>
      Effect.runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
  },
  abort: (_task, runtime, abortContext) =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.suspend(() =>
          awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              abortContext,
            ),
          ),
        ),
      ),
    ),
});

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
    name: "test.child",
    version: 1,
    initial: () => ({ phase: "first" }),
    phases: {
      first: (_task, runtime, phaseContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            entered.resolve();
            yield* awaited(advance.promise);
            yield* awaited(
              runtime.commit(
                () => ({ status: "running", checkpoint: { phase: "next" } }),
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
    abort: (_task, runtime, abortContext) =>
      Effect.runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ status: "terminal", outcome: { status: "aborted" } }),
                abortContext,
              ),
            ),
          ),
        ),
      ),
  });
  return { storage, entered, advance, progress, Child };
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
    status: "waiting",
    checkpoint: { phase: "work" },
    on: [failed, child],
    policy: "failFast",
  } as const;
  return { storage, child, owner, failedRecord, waiting };
});

const restartMarkedTree = Effect.fn("restartMarkedTree")(function* () {
  const storage = new MemoryStorage();
  const session = createSession(storage);
  const conversation = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  const top = yield* awaited(
    session.commit(
      (tx) =>
        tx.createTask(Dormant, null, {
          conversationId: conversation.id,
          ownership: { kind: "conversation" },
        }),
      context,
    ),
  );
  const middle = yield* awaited(
    session.commit(
      (tx) =>
        tx.createTask(Dormant, null, {
          ownership: { kind: "task", taskId: top },
          abandonOnRestart: true,
        }),
      context,
    ),
  );
  const Missing = defineTask<null, { phase: "work" }, null>({
    ...Dormant.definition,
    name: "test.missing",
  });
  const leaf = yield* awaited(
    session.commit(
      (tx) => tx.createTask(Missing, null, { ownership: { kind: "task", taskId: middle } }),
      context,
    ),
  );
  return { storage, top, middle, leaf };
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
  const failure = { status: "failed", error: { message: "failed" } } as const;
  yield* awaited(
    storage.commit(
      [
        {
          type: "task",
          value: { ...owner, abortRequested: true, abortReason: "restart", state: waiting },
        },
        {
          type: "task",
          value: {
            ...failedRecord,
            state: { status: "terminal", outcome: failure },
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
      outcome: { status: "orphaned", reason: "missing_task" },
    });
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(harness.close(context))))));
});

describe("work below a cancelled owner", () => {
  it("lets a failFast request in the same pass override a restart mark", () =>
    Effect.runPromise(letsFailFastRequest));
});

const upgradesRestartMarks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { storage, top, middle, leaf } = yield* restartMarkedTree();
  const { harness } = yield* openTasks(storage, [Dormant]);
  yield* Effect.gen(function* () {
    harness.resume();
    yield* eventually(() =>
      runPromise(
        Effect.gen(function* () {
          return (yield* awaited(harness.getTask(leaf, context)))?.abortReason === "restart";
        }),
      ),
    );
    yield* eventually(() =>
      runPromise(
        Effect.gen(function* () {
          const inspected = (yield* awaited(harness.inspect(context))).tasks.find(
            (task) => task.record.id === leaf,
          );
          return inspected?.state.kind === "blocked";
        }),
      ),
    );
    expect((yield* awaited(harness.getTask(leaf, context)))?.state.status).not.toBe("terminal");
    yield* awaited(harness.abortTask(top, context));
    for (const [id, status] of [
      [leaf, "orphaned"],
      [middle, "aborted"],
      [top, "aborted"],
    ] as const) {
      expect((yield* awaited(harness.waitForTask(id, context))).state.outcome.status).toBe(status);
    }
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(harness.close(context))))));
});

describe("work below a cancelled owner", () => {
  it("upgrades restart marks down the tree when an abort is requested above them", () =>
    Effect.runPromise(upgradesRestartMarks));
});

const marksFlaggedTask = Effect.gen(function* () {
  const storage = new MemoryStorage();
  const session = createSession(storage);
  const conversation = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  const holder = yield* awaited(
    session.commit(
      (tx) =>
        tx.createTask(Dormant, null, {
          conversationId: conversation.id,
          ownership: { kind: "conversation" },
          abandonOnRestart: true,
        }),
      context,
    ),
  );
  const child = yield* awaited(
    session.commit(
      (tx) => tx.createTask(Dormant, null, { ownership: { kind: "task", taskId: holder } }),
      context,
    ),
  );
  const record = (yield* awaited(storage.task(holder, context)))!;
  const completing = {
    status: "completing",
    outcome: { status: "completed", result: null },
  } as const;
  yield* awaited(
    storage.commit(
      [{ type: "task", value: { ...record, state: completing } as typeof record }],
      context,
    ),
  );
  const { harness } = yield* openTasks(storage, [Dormant]);
  yield* Effect.gen(function* () {
    harness.resume();
    expect((yield* awaited(harness.waitForTask(child, context))).state.outcome.status).toBe(
      "aborted",
    );
    const settled = yield* awaited(harness.waitForTask(holder, context));
    expect(settled).toMatchObject({
      abortReason: "restart",
      state: { outcome: { status: "completed" } },
    });
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(harness.close(context))))));
});

describe("work below a cancelled owner", () => {
  it("marks a flagged task that holds its outcome, aborting its owned work, and keeps the outcome", () =>
    Effect.runPromise(marksFlaggedTask));
});
