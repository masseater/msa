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
  Spawner,
  setEntriesDuring,
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

const openOwnedTree = Effect.fn("openOwnedTree")(function* () {
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
            const z = yield* awaited(
              tx.createTask(
                Hold,
                { name: "z" },
                { ownership: { kind: "conversation" }, conversationId: c.id, background: true },
              ),
            );
            return { p, a, b, c: c.id, z };
          }),
        ),
      context,
    ),
  );
  return { harness, tree };
});

const openHeldSiblings = Effect.fn("openHeldSiblings")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const count = 1000;
  const { top, leaves } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const top = yield* awaited(
              tx.createTask(Hold, { name: "top" }, { ownership: { kind: "conversation" } }),
            );
            const siblings: TaskId[] = [];
            for (const n of Array.from({ length: count }, (_, i) => i)) {
              siblings.push(
                yield* awaited(
                  tx.createTask(
                    Hold,
                    { name: `s${n}` },
                    { ownership: { kind: "task", taskId: top } },
                  ),
                ),
              );
            }
            const leaves: TaskId[] = [];
            for (const n of Array.from({ length: count }, (_, i) => count - 1 - i)) {
              const owner = siblings[n]!;
              leaves.push(
                yield* awaited(
                  tx.createTask(
                    Hold,
                    { name: `l${n}` },
                    { ownership: { kind: "task", taskId: owner } },
                  ),
                ),
              );
            }
            return { top, leaves };
          }),
        ),
      context,
    ),
  );
  return { harness, root, count, top, leaves };
});

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

describe("ownership", () => {
  for (const ending of ["completes", "is aborted"] as const) {
    it(`frees an owner that ${ending} once the last work below ended tasks ends after a background task there`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { harness, tree } = yield* openOwnedTree();
          open("a", "completed");
          open("b", "completed");
          yield* awaited(harness.waitForTask(tree.b, context));
          const c = (yield* awaited(harness.conversation(tree.c, context)))!;
          const d = yield* awaited(
            c.commit(
              (tx) =>
                tx.createTask(
                  Hold,
                  { name: "d", slowAbort: true },
                  { ownership: { kind: "conversation" } },
                ),
              context,
            ),
          );
          if (ending === "completes") {
            open("p", "completed");
            yield* waitUntil(
              Effect.gen(function* () {
                return (yield* status(harness, tree.p)).status === "completing";
              }),
            );
          } else {
            yield* awaited(harness.abortTask(tree.p, context));
            yield* waitUntil(
              Effect.gen(function* () {
                return (yield* awaited(harness.getTask(d, context)))!.abortRequested;
              }),
            );
          }
          open("z", "completed");
          yield* awaited(harness.waitForTask(tree.z, context));
          if (ending === "completes") open("d", "completed");
          else open("abort.d", "completed");
          yield* awaited(harness.waitForTask(d, context));
          const expected = ending === "completes" ? "completed" : "aborted";
          expect((yield* awaited(harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
            expected,
          );
          yield* awaited(harness.close(context));
        }),
      ));
  }
});

const finalizesManyHeld = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, count, top, leaves } = yield* openHeldSiblings();
  for (let n = 0; n < count; n++) open(`s${n}`, "completed");
  open("top", "completed");
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(harness, top)).status === "completing";
    }),
  );
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const records = [];
            for (const id of leaves) records.push((yield* awaited(tx.task(id)))!);
            for (const record of records) {
              (tx as unknown as { setTask(value: unknown): void }).setTask({
                ...record,
                state: { status: "terminal", outcome: { status: "completed", result: null } },
              });
            }
          }),
        ),
      context,
    ),
  );
  const entries = yield* setEntriesDuring(() =>
    runPromise(
      Effect.gen(function* () {
        expect((yield* awaited(harness.waitForTask(top, context))).state.outcome.status).toBe(
          "completed",
        );
      }),
    ),
  );
  expect(entries).toBeLessThan(count * 20);
  yield* awaited(harness.close(context));
});

const rejectsConversationCreated = Effect.gen(function* () {
  const { harness, root } = yield* openHarness();
  const spawner = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Spawner, { name: "spawned" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  expect((yield* awaited(harness.waitForTask(spawner, context))).state.outcome).toEqual({
    status: "faulted",
    error: {
      message: expect.stringMatching(
        new RegExp(`^Conversation owner task ${spawner} is (completing|terminal)$`, "u"),
      ),
    },
  });
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("finalizes many held siblings that end together in one pass", () =>
    Effect.runPromise(finalizesManyHeld));

  it("rejects a conversation created in the commit that ends its owner task", () =>
    Effect.runPromise(rejectsConversationCreated));
});
