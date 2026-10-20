import { defineTask } from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { Hold, busy, directories, gates, open, openHarness, ownedChild, runs, waitUntil } =
  harnessOwnershipSupport;
const { joinPath, makeTempDir, removeDir } = platformSupport;
const { context } = sessionSupport;

const Unregistered = defineTask<{ name: string }, { phase: "hold" }, null>({
  abort: () => Promise.resolve(),
  initial: () => ({ phase: "hold" }),
  name: "test.unregistered",
  phases: { hold: () => Promise.resolve() },
  version: 1,
});

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const orphanBelowOwner = Effect.fn("orphanBelowOwner")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-ownership-");
  directories.add(directory);
  const path = joinPath(directory, "session.sqlite");
  const session = createSession(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const root = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            const owner = yield* awaited(
              tx.createTask(
                Hold,
                { name: "gone" },
                { conversationId: root.id, ownership: { kind: "conversation" } },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: owner } }),
            );
            return {
              inner: yield* awaited(
                tx.createTask(
                  Hold,
                  { name: "orphan" },
                  { conversationId: child.id, ownership: { kind: "conversation" } },
                ),
              ),
              owner,
            };
          }),
        ),
      context,
    ),
  );
  return { path, session, tree };
});

const crashCases = [
  [
    "a held failed owner",
    false,
    { outcome: { error: { message: "crash" }, status: "failed" }, status: "completing" },
  ],
  ["an abort-marked owner", true, { checkpoint: { phase: "hold" }, status: "pending" }],
] as const;

const derivesMarksCrash = Effect.fn("derivesMarksCrash")(function* (
  abortRequested: boolean,
  state: (typeof crashCases)[number][2],
) {
  const { path, session, tree } = yield* orphanBelowOwner();
  yield* awaited(
    session.commit(
      (tx) =>
        tx.task(tree.owner).then((record) => {
          (tx as unknown as { setTask(value: unknown): void }).setTask({
            ...record!,
            abortRequested,
            state,
          });
          return undefined;
        }),
      context,
    ),
  );
  yield* awaited(session.close(context));

  const { harness } = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  expect((yield* awaited(harness.waitForTask(tree.inner, context))).state.outcome.status).toBe(
    "aborted",
  );
  const outcome = (yield* awaited(harness.waitForTask(tree.owner, context))).state.outcome.status;
  expect(outcome).toBe(abortRequested ? "aborted" : "failed");
  yield* awaited(harness.close(context));
});

const withdrawsInputQueued = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "owner", { slowInner: true }));
  const child = (yield* awaited(harness.conversation(tree.child, context)))!;
  yield* busy(child, tree.inner);
  open("owner", "failed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* awaited(harness.getTask(tree.inner, context)))!.abortRequested;
    }),
  );
  const late = yield* awaited(child.submit({ content: "late", type: "input" }, context));
  expect(yield* awaited(late.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  open("abort.owner.inner", "completed");
  yield* awaited(harness.waitForTask(tree.owner, context));
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  for (const [label, abortRequested, state] of crashCases) {
    it(`derives marks a crash left unapplied below ${label} at open`, () =>
      Effect.runPromise(derivesMarksCrash(abortRequested, state)));
  }

  it("withdraws an input queued below a held failed owner after its cascade", () =>
    Effect.runPromise(withdrawsInputQueued));
});

const marksWorkAdmitted = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-durable-ownership-");
  directories.add(directory);
  const path = joinPath(directory, "session.sqlite");
  let opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(ownedChild(opened.root, "owner", { slowOwner: true }));
  open("owner.inner", "completed");
  yield* awaited(opened.harness.waitForTask(tree.inner, context));
  yield* awaited(opened.harness.abortTask(tree.owner, context));
  yield* awaited(opened.harness.close(context));

  opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  const child = (yield* awaited(opened.harness.conversation(tree.child, context)))!;
  const late = yield* awaited(
    child.commit(
      (tx) => tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  expect((yield* awaited(opened.harness.waitForTask(late, context))).state.outcome.status).toBe(
    "aborted",
  );
  open("abort.owner", "completed");
  expect(
    (yield* awaited(opened.harness.waitForTask(tree.owner, context))).state.outcome.status,
  ).toBe("aborted");
  yield* awaited(opened.harness.close(context));
});

describe("ownership", () => {
  it("marks work admitted after reopen below a cancelled owner whose edge was not loaded", () =>
    Effect.runPromise(marksWorkAdmitted));
});

const cascadesOwnerScheduler = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const { owner, inner } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const ownerInner = yield* awaited(
              tx.createTask(
                Unregistered,
                { name: "unregistered" },
                { ownership: { kind: "conversation" } },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: ownerInner } }),
            );
            return {
              inner: yield* awaited(
                tx.createTask(
                  Hold,
                  { name: "below" },
                  { conversationId: child.id, ownership: { kind: "conversation" } },
                ),
              ),
              owner: ownerInner,
            };
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(harness.abortTask(owner, context))).toBe("marked");
  expect((yield* awaited(harness.waitForTask(owner, context))).state.outcome).toEqual({
    reason: "missing_task",
    status: "orphaned",
  });
  expect((yield* awaited(harness.waitForTask(inner, context))).state.outcome.status).toBe(
    "aborted",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("cascades from an owner the scheduler orphans", () =>
    Effect.runPromise(cascadesOwnerScheduler));
});
