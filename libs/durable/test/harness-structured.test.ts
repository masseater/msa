import { type ConversationId, type TaskId, type TaskOptions } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gate,
  gates,
  until,
  start,
  Node,
  end,
  type NodeInput,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  owned,
  script,
  directories,
} from "./harness-structured-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

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

const createsChildOwner = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let child: TaskId | undefined;
  script("parent", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              child = yield* awaited(spawn(tx, runtime.taskId, "child"));
              return waitOn([child], "allSettled");
            }),
          ),
        ctx,
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() => child !== undefined);
  const record = (yield* awaited(harness.getTask(child!, context)))!;
  expect(record).toMatchObject({ owner: parent, conversationId: root.id, background: false });
  expect((yield* awaited(harness.getTask(parent, context)))!.owner).toBeUndefined();
  open("child");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  yield* awaited(harness.close(context));
});

const rejectsNoOwnership = Effect.gen(function* () {
  const { harness, root } = yield* openNodes();
  const parent = yield* awaited(start(root, "parent"));
  const other = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const create = (options: TaskOptions) =>
    root.commit((tx) => tx.createTask(Node, { name: "x" }, options), context);
  yield* awaited(expect(create({} as TaskOptions)).rejects.toThrow());
  yield* awaited(expect(create(owned(999_999 as TaskId))).rejects.toThrow("does not exist"));
  yield* awaited(
    expect(create({ ...owned(parent), conversationId: other.id })).rejects.toThrow(
      "owner's conversation",
    ),
  );
  yield* awaited(
    expect(create({ ...owned(parent), background: true })).rejects.toThrow("cannot be background"),
  );
  const child = yield* awaited(other.commit((tx) => spawn(tx, parent, "child"), context));
  expect((yield* awaited(harness.getTask(child, context)))!.conversationId).toBe(root.id);
  open("parent");
  open("child");
  yield* awaited(harness.waitForTask(parent, context));
  yield* awaited(harness.close(context));
});

describe("task ownership", () => {
  it("creates a child in its owner's conversation with its owner recorded", () =>
    Effect.runPromise(createsChildOwner));

  it("rejects no ownership, a missing owner, a child in another conversation, and a background child", () =>
    Effect.runPromise(rejectsNoOwnership));
});

const rejectsNewOwnedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
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
                    yield* awaited(spawn(tx, runtime.taskId, "child"));
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "completing";
    }),
  );
  const createChild = () => root.commit((tx) => spawn(tx, parent, "late"), context);
  const createConversation = () =>
    root.commit(
      (tx) => tx.createConversation({ ownership: { kind: "task", taskId: parent } }),
      context,
    );
  yield* awaited(expect(createChild()).rejects.toThrow("is completing"));
  yield* awaited(expect(createConversation()).rejects.toThrow("is completing"));
  open("child");
  yield* awaited(harness.waitForTask(parent, context));
  yield* awaited(expect(createChild()).rejects.toThrow("is terminal"));
  return { runPromise, harness, root, createConversation };
});

const rejectsNewOwned = Effect.gen(function* () {
  const { runPromise, harness, root, createConversation } = yield* rejectsNewOwnedStep1;
  yield* awaited(expect(createConversation()).rejects.toThrow("is terminal"));

  script("slow", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(gate("abort.slow").promise);
          yield* awaited(
            runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
          );
        }),
      ),
  });
  const slow = yield* awaited(start(root, "slow"));
  yield* until(() => log.includes("run:slow"));
  yield* awaited(harness.abortTask(slow, context));
  yield* awaited(
    expect(root.commit((tx) => spawn(tx, slow, "late"), context)).rejects.toThrow(
      "is abort-marked",
    ),
  );
  open("abort.slow");
  expect(yield* awaited(outcomeOf(harness, slow))).toBe("aborted");
  yield* awaited(harness.close(context));
});

describe("task ownership", () => {
  it("rejects new owned work below an owner that is completing, terminal, or abort-marked", () =>
    Effect.runPromise(rejectsNewOwned));
});

const cannotCreateChildStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  script("eager", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              yield* awaited(spawn(tx, runtime.taskId, "never"));
              return end("completed", "eager");
            }),
          ),
        ctx,
      ),
  });
  const eager = yield* awaited(start(root, "eager"));
  expect((yield* awaited(harness.waitForTask(eager, context))).state.outcome).toMatchObject({
    status: "faulted",
    error: { message: expect.stringContaining("is completing") },
  });
  const nodes = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: "test.node" }, 20), context),
  );
  expect(nodes.items.map((task) => (task.input as NodeInput).name)).toEqual(["eager"]);
  return { runPromise, harness, root };
});

const cannotCreateChild = Effect.gen(function* () {
  const { runPromise, harness, root } = yield* cannotCreateChildStep1;
  let child: ConversationId | undefined;
  script("host", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              child = (yield* awaited(
                tx.createConversation({
                  ownership: { kind: "task", taskId: runtime.taskId },
                }),
              )).id;
              return { status: "running", checkpoint: { phase: "resume", round: 1 } };
            }),
          ),
        ctx,
      ),
    resume: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              yield* awaited(
                tx.createTask(
                  Node,
                  { name: "inner" },
                  { ...OWN_CONVERSATION, conversationId: child! },
                ),
              );
              return end("completed", "host");
            }),
          ),
        ctx,
      ),
  });
  const host = yield* awaited(start(root, "host"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, host)).status === "completing";
    }),
  );
  expect(yield* settled(harness.waitForTask(host, context))).toBe(false);
  open("inner");
  expect(yield* awaited(outcomeOf(harness, host))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("task ownership", () => {
  it("cannot create a child in its finishing commit, but work it starts in an owned conversation holds it", () =>
    Effect.runPromise(cannotCreateChild));
});
