import { type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { Hold, directories, gates, open, openHarness, runs, status, waitUntil } =
  harnessOwnershipSupport;
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

const endedBridge = Effect.fn("endedBridge")(function* (depth: number) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(
                Hold,
                { name: "p", slowAbort: true },
                { ownership: { kind: "conversation" } },
              ),
            );
            const links: TaskId[] = [];
            let owner = p;
            for (const n of Array.from({ length: depth }, (_, i) => i)) {
              owner = yield* awaited(
                tx.createTask(
                  Hold,
                  { name: `link${n}` },
                  { ownership: { kind: "task", taskId: owner } },
                ),
              );
              links.push(owner);
            }
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: owner } }),
            );
            return { c: c.id, links, p };
          }),
        ),
      context,
    ),
  );
  for (let n = depth - 1; n >= 0; n--) open(`link${n}`, "completed");
  for (const id of tree.links) yield* awaited(harness.waitForTask(id, context));
  const c = (yield* awaited(harness.conversation(tree.c, context)))!;
  const create = (name: string) =>
    c.commit(
      (tx) => tx.createTask(Hold, { name }, { ownership: { kind: "conversation" } }),
      context,
    );
  return { create, harness, p: tree.p, root };
});

describe("ownership", () => {
  for (const depth of [2, 5]) {
    it(`aborts work below ${depth} ended tasks with their live owner, which waits for it`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { harness, p, create } = yield* endedBridge(depth);
          const d = yield* awaited(create("d"));
          yield* awaited(harness.abortTask(p, context));
          expect((yield* awaited(harness.waitForTask(d, context))).state.outcome.status).toBe(
            "aborted",
          );
          open("abort.p", "completed");
          expect((yield* awaited(harness.waitForTask(p, context))).state.outcome.status).toBe(
            "aborted",
          );
          yield* awaited(harness.close(context));
        }),
      ));

    it(`keeps the root busy and aborts with it work below ${depth} ended tasks`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { harness, root, p, create } = yield* endedBridge(depth);
          open("p", "completed");
          yield* awaited(harness.waitForTask(p, context));
          const d = yield* awaited(create("d"));
          const d2 = yield* awaited(create("d2"));
          expect(yield* settled(root.waitForIdle(context))).toBe(false);
          expect(yield* settled(harness.waitForIdle(context))).toBe(false);
          yield* awaited(root.abort(context));
          for (const id of [d, d2])
            expect((yield* awaited(harness.waitForTask(id, context))).state.outcome.status).toBe(
              "aborted",
            );
          yield* awaited(harness.close(context));
        }),
      ));
  }
});

const reachesWorkBelowStep1 = Effect.gen(function* () {
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
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            const x = yield* awaited(
              tx.createTask(
                Hold,
                { name: "x" },
                { conversationId: c.id, ownership: { kind: "conversation" } },
              ),
            );
            const a = yield* awaited(
              tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: x } }),
            );
            const c2 = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: a } }),
            );
            return { b, c2: c2.id, p, x };
          }),
        ),
      context,
    ),
  );
  open("a", "completed");
  open("x", "completed");
  open("b", "completed");
  yield* awaited(harness.waitForTask(tree.b, context));
  const c2 = (yield* awaited(harness.conversation(tree.c2, context)))!;
  return { c2, harness, root, tree };
});

const reachesWorkBelow = Effect.gen(function* () {
  const { harness, root, tree, c2 } = yield* reachesWorkBelowStep1;
  const d = yield* awaited(
    c2.commit(
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
  expect(yield* settled(root.waitForIdle(context))).toBe(false);
  yield* awaited(root.abort(context));
  expect((yield* awaited(harness.waitForTask(d, context))).state.outcome.status).toBe("aborted");
  expect((yield* awaited(harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("reaches work below ended tasks across two owned conversations", () =>
    Effect.runPromise(reachesWorkBelow));
});
