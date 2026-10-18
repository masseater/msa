import { type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  directories,
  status,
  waitUntil,
  open,
  gates,
  Hold,
  runs,
  openHarness,
} from "./harness-ownership-support.ts";
import { removeDir } from "./platform-support.ts";
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
            return { p, links, c: c.id };
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
  return { harness, root, p: tree.p, create };
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

const reachesWorkBelow = Effect.gen(function* () {
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
                { ownership: { kind: "conversation" }, conversationId: c.id },
              ),
            );
            const a = yield* awaited(
              tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: x } }),
            );
            const c2 = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: a } }),
            );
            return { p, b, x, c2: c2.id };
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
