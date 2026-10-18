import { type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import {
  directories,
  status,
  waitUntil,
  open,
  gates,
  ownedChild,
  Hold,
  runs,
  openHarness,
  setEntriesDuring,
} from "./harness-ownership-support.ts";
import { joinPath, makeTempDir, removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

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

const keepsConversationBusy = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "owner"));
  open("owner", "completed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(harness, tree.owner)).status === "completing";
    }),
  );
  const idle = root.waitForIdle(context);
  expect(yield* settled(idle)).toBe(false);
  expect(yield* settled(harness.waitForIdle(context))).toBe(false);
  open("owner.inner", "completed");
  yield* awaited(idle);
  yield* awaited(harness.waitForIdle(context));
  expect((yield* status(harness, tree.owner)).outcome?.status).toBe("completed");
  yield* awaited(harness.close(context));
});

const holdsOwnerWork = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const { owner, child, conversation } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const owner = yield* awaited(
              tx.createTask(Hold, { name: "owner" }, { ownership: { kind: "conversation" } }),
            );
            const child = yield* awaited(
              tx.createTask(
                Hold,
                { name: "child" },
                { ownership: { kind: "task", taskId: owner } },
              ),
            );
            const conversation = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: child },
              }),
            );
            return { owner, child, conversation: conversation.id };
          }),
        ),
      context,
    ),
  );
  open("child", "completed");
  expect((yield* awaited(harness.waitForTask(child, context))).state.outcome.status).toBe(
    "completed",
  );
  const handle = (yield* awaited(harness.conversation(conversation, context)))!;
  yield* awaited(
    handle.commit(
      (tx) => tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  open("owner", "completed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(harness, owner)).status === "completing";
    }),
  );
  open("late", "completed");
  expect((yield* awaited(harness.waitForTask(owner, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("keeps a conversation busy while its owned foreground subtree has live work, holding the completed owner", () =>
    Effect.runPromise(keepsConversationBusy));

  it("holds an owner for work in a conversation its ended child task owns", () =>
    Effect.runPromise(holdsOwnerWork));
});

const cascadesThroughEnded = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const a = yield* awaited(
              tx.createTask(Hold, { name: "a" }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: a } }),
            );
            const conversation = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            const c = yield* awaited(
              tx.createTask(
                Hold,
                { name: "c" },
                {
                  ownership: { kind: "conversation" },
                  conversationId: conversation.id,
                  background: true,
                },
              ),
            );
            const d = yield* awaited(
              tx.createTask(Hold, { name: "d" }, { ownership: { kind: "task", taskId: c } }),
            );
            return { a, b, c, d };
          }),
        ),
      context,
    ),
  );
  open("b", "completed");
  open("a", "completed");
  expect((yield* awaited(harness.waitForTask(tree.a, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(root.abort(context, { background: true }));
  for (const id of [tree.c, tree.d]) {
    expect((yield* awaited(harness.waitForTask(id, context))).state.outcome.status).toBe("aborted");
  }
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("cascades through ended tasks into an owned background subtree when aborting across background", () =>
    Effect.runPromise(cascadesThroughEnded));
});

const keepsOwnershipQueries = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const owner = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Hold, { name: "owner" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const chains = 50;
  const tasks: TaskId[] = [];
  for (const n of Array.from({ length: chains }, (_, i) => i)) {
    const ids = yield* awaited(
      root.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const first = yield* awaited(
                tx.createTask(
                  Hold,
                  { name: `c${n}.0` },
                  { ownership: { kind: "task", taskId: owner } },
                ),
              );
              const second = yield* awaited(
                tx.createTask(
                  Hold,
                  { name: `c${n}.1` },
                  { ownership: { kind: "task", taskId: first } },
                ),
              );
              yield* awaited(
                tx.createConversation({ ownership: { kind: "task", taskId: second } }),
              );
              return [first, second];
            }),
          ),
        context,
      ),
    );
    tasks.push(...ids);
  }
  for (let n = 0; n < chains; n++) {
    open(`c${n}.1`, "completed");
    open(`c${n}.0`, "completed");
  }
  for (const id of tasks) yield* awaited(harness.waitForTask(id, context));
  const entries = yield* setEntriesDuring(() =>
    runPromise(
      Effect.gen(function* () {
        open("owner", "completed");
        expect((yield* awaited(harness.waitForTask(owner, context))).state.outcome.status).toBe(
          "completed",
        );
      }),
    ),
  );
  expect(entries).toBeLessThan(chains);
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("keeps ownership queries off finished subtrees", () =>
    Effect.runPromise(keepsOwnershipQueries));
});

const tracksOwnershipChains = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const depth = 20_000;
  const { top, leaf } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const top = yield* awaited(
              tx.createTask(Hold, { name: "top" }, { ownership: { kind: "conversation" } }),
            );
            let owner = top;
            for (const n of Array.from({ length: depth }, (_, i) => i)) {
              owner = yield* awaited(
                tx.createTask(
                  Hold,
                  { name: `link${n}` },
                  { ownership: { kind: "task", taskId: owner } },
                ),
              );
            }
            const leaf = yield* awaited(
              tx.createTask(Hold, { name: "leaf" }, { ownership: { kind: "task", taskId: owner } }),
            );
            return { top, leaf };
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

const holdsOwnerWorkCommit = Effect.gen(function* () {
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
            return { p, a, b, c: c.id };
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
            return { p, a, b, c: c.id };
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
