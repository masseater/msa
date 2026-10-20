import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { openNodeSqliteStorage } = node;

const { awaited } = effectSupport;
const { Hold, busy, directories, gates, open, openHarness, ownedChild, runs, status, waitUntil } =
  harnessOwnershipSupport;
const { joinPath, makeTempDir, removeDir } = platformSupport;
const { context } = sessionSupport;
const { settled } = taskSupport;

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

function queuedNote(text: string) {
  return { kind: "note", model: [{ content: text, role: "user", timestamp: 0 }] } as const;
}

const stopsIdleTraversal = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "background", { background: true }));
  yield* awaited(root.waitForIdle(context));
  yield* awaited(harness.waitForIdle(context));
  const child = (yield* awaited(harness.conversation(tree.child, context)))!;
  expect(yield* settled(child.waitForIdle(context))).toBe(false);
  yield* awaited(child.abort(context));
  yield* awaited(harness.close(context));
});

const cascadesAbortMark = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "owner"));
  const nested = yield* awaited(harness.conversation(tree.child, context));
  const deeper = yield* awaited(ownedChild(nested!, "deeper"));
  const shielded = yield* awaited(ownedChild(nested!, "shielded", { background: true }));
  yield* busy(nested!, tree.inner);
  const queued = (yield* awaited(nested!.submit({ content: "later", type: "input" }, context))).id;
  expect(yield* awaited(harness.abortTask(tree.owner, context))).toBe("marked");
  for (const id of [tree.owner, tree.inner, deeper.owner, deeper.inner]) {
    expect((yield* awaited(harness.waitForTask(id, context))).state.outcome.status).toBe("aborted");
  }
  expect((yield* status(harness, shielded.owner)).status).not.toBe("terminal");
  expect((yield* status(harness, shielded.inner)).status).not.toBe("terminal");
  expect(
    yield* awaited((yield* awaited(harness.submission(queued, context)))!.status(context)),
  ).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  yield* awaited(harness.abortTask(shielded.owner, context));
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("stops idle traversal at a background owner", () => Effect.runPromise(stopsIdleTraversal));

  it("cascades an abort mark to the owned foreground subtree and withdraws its queued inputs", () =>
    Effect.runPromise(cascadesAbortMark));
});

const cascadesFailedOwner = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const failed = yield* awaited(ownedChild(root, "failed"));
  const completedTree = yield* awaited(ownedChild(root, "done"));
  open("failed", "failed");
  open("done", "completed");
  expect((yield* awaited(harness.waitForTask(failed.inner, context))).state.outcome.status).toBe(
    "aborted",
  );
  expect((yield* awaited(harness.waitForTask(failed.owner, context))).state.outcome.status).toBe(
    "failed",
  );
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(harness, completedTree.owner)).status === "completing";
    }),
  );
  expect((yield* status(harness, completedTree.inner)).status).not.toBe("terminal");
  open("done.inner", "completed");
  expect(
    (yield* awaited(harness.waitForTask(completedTree.owner, context))).state.outcome.status,
  ).toBe("completed");
  yield* awaited(harness.close(context));
});

const abortsBackgroundTask = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "background", { background: true }));
  yield* awaited(harness.abortTask(tree.owner, context));
  expect((yield* awaited(harness.waitForTask(tree.inner, context))).state.outcome.status).toBe(
    "aborted",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("cascades a failed owner but not a completed one", () =>
    Effect.runPromise(cascadesFailedOwner));

  it("aborts a background task directly with its ordinary subtree", () =>
    Effect.runPromise(abortsBackgroundTask));
});

const abortsConversationQueued = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const foreground = yield* awaited(ownedChild(root, "foreground"));
  const background = yield* awaited(ownedChild(root, "background", { background: true }));
  yield* busy(root, foreground.owner);
  const input = (yield* awaited(root.submit({ content: "later", type: "input" }, context))).id;
  const write = (yield* awaited(root.submit({ entry: queuedNote("w"), type: "write" }, context)))
    .id;
  yield* awaited(root.abort(context));
  for (const id of [foreground.owner, foreground.inner]) {
    expect((yield* status(harness, id)).status).toBe("terminal");
  }
  expect((yield* status(harness, background.owner)).status).not.toBe("terminal");
  expect((yield* status(harness, background.inner)).status).not.toBe("terminal");
  expect(
    yield* awaited((yield* awaited(harness.submission(input, context)))!.status(context)),
  ).toMatchObject({
    reason: "aborted",
  });
  expect(
    (yield* awaited((yield* awaited(harness.submission(write, context)))!.status(context))).status,
  ).toBe("queued");
  yield* awaited(harness.abortTask(background.owner, context));
  yield* awaited(harness.close(context));
});

const abortsWorkCreated = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "owner", { slowInner: true }));
  open("owner", "failed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* awaited(harness.getTask(tree.inner, context)))!.abortRequested;
    }),
  );
  expect((yield* status(harness, tree.owner)).status).toBe("completing");
  const child = (yield* awaited(harness.conversation(tree.child, context)))!;
  const create = (name: string) =>
    child.commit(
      (tx) => tx.createTask(Hold, { name }, { ownership: { kind: "conversation" } }),
      context,
    );
  const during = yield* awaited(create("during"));
  expect((yield* awaited(harness.waitForTask(during, context))).state.outcome.status).toBe(
    "aborted",
  );
  open("abort.owner.inner", "completed");
  expect((yield* awaited(harness.waitForTask(tree.owner, context))).state.outcome.status).toBe(
    "failed",
  );
  const after = yield* awaited(create("after"));
  open("after", "completed");
  expect((yield* awaited(harness.waitForTask(after, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("aborts a conversation: queued inputs withdrawn, writes kept, foreground work aborted, background kept", () =>
    Effect.runPromise(abortsConversationQueued));

  it("aborts work created below a held failed owner, but not below a terminal one", () =>
    Effect.runPromise(abortsWorkCreated));
});

const withdrawsQueuedInputs = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "owner"));
  const child = (yield* awaited(harness.conversation(tree.child, context)))!;
  yield* busy(root, tree.owner);
  yield* busy(child, tree.inner);
  const own = (yield* awaited(root.submit({ content: "own", type: "input" }, context))).id;
  const below = (yield* awaited(child.submit({ content: "below", type: "input" }, context))).id;
  const write = (yield* awaited(child.submit({ entry: queuedNote("w"), type: "write" }, context)))
    .id;
  yield* awaited(harness.abortTask(tree.owner, context));
  yield* awaited(harness.waitForTask(tree.inner, context));
  const statusOf = (id: typeof own) =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited((yield* awaited(harness.submission(id, context)))!.status(context)))
          .status;
      }),
    );
  expect(yield* awaited(statusOf(own))).toBe("queued");
  expect(yield* awaited(statusOf(below))).toBe("unanswered");
  expect(yield* awaited(statusOf(write))).toBe("queued");
  yield* awaited(harness.close(context));
});

const keepsNestedBackground = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const outer = yield* awaited(ownedChild(root, "outer", { background: true }));
  const inner = yield* awaited(
    ownedChild((yield* awaited(harness.conversation(outer.child, context)))!, "inner", {
      background: true,
    }),
  );
  yield* awaited(harness.abortTask(outer.owner, context));
  expect((yield* awaited(harness.waitForTask(outer.inner, context))).state.outcome.status).toBe(
    "aborted",
  );
  expect((yield* status(harness, inner.owner)).status).not.toBe("terminal");
  expect((yield* status(harness, inner.inner)).status).not.toBe("terminal");
  yield* awaited(harness.abortTask(inner.owner, context));
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("withdraws queued inputs below the aborted task but keeps its own conversation's queue and queued writes", () =>
    Effect.runPromise(withdrawsQueuedInputs));

  it("keeps a nested background owner's subtree when its cancelled background owner is aborted", () =>
    Effect.runPromise(keepsNestedBackground));
});

const decidesIdleReopen = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-durable-ownership-");
  directories.add(directory);
  const path = joinPath(directory, "session.sqlite");
  let opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  const foreground = yield* awaited(ownedChild(opened.root, "fg"));
  const deeper = yield* awaited(
    ownedChild((yield* awaited(opened.harness.conversation(foreground.child, context)))!, "fg2"),
  );
  const background = yield* awaited(ownedChild(opened.root, "bg", { background: true }));
  open("fg", "completed");
  open("fg2", "completed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(opened.harness, foreground.owner)).status === "completing";
    }),
  );
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(opened.harness, deeper.owner)).status === "completing";
    }),
  );
  yield* awaited(opened.harness.close(context));

  opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  expect(yield* settled(opened.root.waitForIdle(context))).toBe(false);
  expect(yield* settled(opened.harness.waitForIdle(context))).toBe(false);
  open("fg.inner", "completed");
  open("fg2.inner", "completed");
  yield* awaited(opened.root.waitForIdle(context));
  yield* awaited(opened.harness.waitForIdle(context));
  expect((yield* status(opened.harness, foreground.owner)).status).toBe("terminal");
  expect((yield* status(opened.harness, background.inner)).status).not.toBe("terminal");
  yield* awaited(opened.harness.abortTask(background.owner, context));
  yield* awaited(opened.harness.close(context));
});

describe("ownership", () => {
  it("decides idle after reopen from owner edges it has to load first", () =>
    Effect.runPromise(decidesIdleReopen));
});
