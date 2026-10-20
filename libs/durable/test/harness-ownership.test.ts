import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const {
  Hold,
  directories,
  gates,
  open,
  openHarness,
  ownedChild,
  runs,
  setEntriesDuring,
  status,
  waitUntil,
} = harnessOwnershipSupport;
const { removeDir } = platformSupport;
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

const holdsOwnerWorkStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const { owner, child, conversation } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const ownerInner = yield* awaited(
              tx.createTask(Hold, { name: "owner" }, { ownership: { kind: "conversation" } }),
            );
            const childInner = yield* awaited(
              tx.createTask(
                Hold,
                { name: "child" },
                { ownership: { kind: "task", taskId: ownerInner } },
              ),
            );
            const conversationInner = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: childInner },
              }),
            );
            return { child: childInner, conversation: conversationInner.id, owner: ownerInner };
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
  return { harness, owner };
});

const holdsOwnerWork = Effect.gen(function* () {
  const { harness, owner } = yield* holdsOwnerWorkStep1;
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
                  background: true,
                  conversationId: conversation.id,
                  ownership: { kind: "conversation" },
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

const keepsOwnershipQueriesStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const owner = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Hold, { name: "owner" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const chains = 50;
  const tasks: durableTypes.TaskId[] = [];
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
  return { chains, harness, owner, runPromise, tasks };
});

const keepsOwnershipQueries = Effect.gen(function* () {
  const { runPromise, harness, owner, chains, tasks } = yield* keepsOwnershipQueriesStep1;
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
