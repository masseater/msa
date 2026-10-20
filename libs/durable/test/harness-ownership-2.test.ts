import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { Hold, directories, gates, open, openHarness, runs, status, waitUntil } =
  harnessOwnershipSupport;
const { joinPath, makeTempDir, removeDir } = platformSupport;
const { context } = sessionSupport;

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

const tracksOwnershipChains = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const depth = 20_000;
  const { top, leaf } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const topInner = yield* awaited(
              tx.createTask(Hold, { name: "top" }, { ownership: { kind: "conversation" } }),
            );
            let owner = topInner;
            for (const n of Array.from({ length: depth }, (_, i) => i)) {
              owner = yield* awaited(
                tx.createTask(
                  Hold,
                  { name: `link${n}` },
                  { ownership: { kind: "task", taskId: owner } },
                ),
              );
            }
            const leafInner = yield* awaited(
              tx.createTask(Hold, { name: "leaf" }, { ownership: { kind: "task", taskId: owner } }),
            );
            return { leaf: leafInner, top: topInner };
          }),
        ),
      context,
    ),
  );
  for (let n = 0; n < depth; n++) open(`link${n}`, "completed");
  open("top", "completed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(harness, top)).status === "completing";
    }),
  );
  open("leaf", "completed");
  expect((yield* awaited(harness.waitForTask(leaf, context))).state.outcome.status).toBe(
    "completed",
  );
  expect((yield* awaited(harness.waitForTask(top, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it(
    "tracks ownership chains deeper than the call stack",
    () => Effect.runPromise(tracksOwnershipChains),
    60_000,
  );
});

const holdsOwnerWorkCommitStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-ownership-");
  directories.add(directory);
  const path = joinPath(directory, "session.sqlite");
  let opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(
    opened.root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const a = yield* awaited(
              tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: b } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: a } }),
            );
            return { a, b, c: c.id, p };
          }),
        ),
      context,
    ),
  );
  open("a", "completed");
  open("b", "completed");
  yield* awaited(opened.harness.waitForTask(tree.a, context));
  yield* awaited(opened.harness.waitForTask(tree.b, context));
  yield* awaited(opened.harness.close(context));
  opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  const c = (yield* awaited(opened.harness.conversation(tree.c, context)))!;
  const d = yield* awaited(
    c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  open("p", "completed");
  return { d, opened, tree };
});

const holdsOwnerWorkCommit = Effect.gen(function* () {
  const { opened, tree, d } = yield* holdsOwnerWorkCommitStep1;
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(opened.harness, tree.p)).status === "completing";
    }),
  );
  open("d", "completed");
  expect((yield* awaited(opened.harness.waitForTask(d, context))).state.outcome.status).toBe(
    "completed",
  );
  expect((yield* awaited(opened.harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(opened.harness.close(context));
});

describe("ownership", () => {
  it("holds an owner for work a commit creates below ended tasks loaded from storage", () =>
    Effect.runPromise(holdsOwnerWorkCommit));
});

const holdsOwnerWorkCreated = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const a = yield* awaited(
              tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: b } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: a } }),
            );
            return { a, b, c: c.id, p };
          }),
        ),
      context,
    ),
  );
  open("a", "completed");
  open("b", "completed");
  yield* awaited(harness.waitForTask(tree.b, context));
  const c = (yield* awaited(harness.conversation(tree.c, context)))!;
  const d = yield* awaited(
    c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  open("p", "completed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(harness, tree.p)).status === "completing";
    }),
  );
  open("d", "completed");
  expect((yield* awaited(harness.waitForTask(d, context))).state.outcome.status).toBe("completed");
  expect((yield* awaited(harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("holds an owner for work created later below ended tasks, without a reopen", () =>
    Effect.runPromise(holdsOwnerWorkCreated));
});
