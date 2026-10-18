import { LiveDoc, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import {
  status,
  sizes,
  subagentCycle,
  gate,
  gates,
  Hold,
  runs,
  directories,
  sqlitePath,
  open,
  Rejected,
  rejections,
} from "./harness-scheduler-retention-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { eventually } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      rejections.length = 0;
      for (const directory of directories.splice(0)) yield* removeDir(directory);
    }),
  ),
);

const endedLevelsTree = Effect.fn("endedLevelsTree")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
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
            const keep = yield* awaited(
              tx.createTask(Hold, { name: "keep" }, { ownership: { kind: "task", taskId: p } }),
            );
            return { p, b, c: c.id, keep };
          }),
        ),
      context,
    ),
  );
  return { harness, tree };
});

const keepsChainOne = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
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
            const old = yield* awaited(
              tx.createTask(
                Hold,
                { name: "old" },
                {
                  ownership: { kind: "conversation" },
                  conversationId: c.id,
                  background: true,
                },
              ),
            );
            return { p, b, c: c.id, old };
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  const replacement = yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const old = (yield* awaited(tx.task(tree.old)))!;
            const id = yield* awaited(
              tx.createTask(
                Hold,
                { name: "new" },
                { ownership: { kind: "conversation" }, conversationId: tree.c },
              ),
            );
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...old,
              state: { status: "terminal", outcome: { status: "completed", result: null } },
            });
            return id;
          }),
        ),
      context,
    ),
  );
  gate("p").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* status(harness, tree.p)).status === "completing";
      }),
    ),
  );
  gate("new").resolve();
  yield* awaited(harness.waitForTask(replacement, context));
  expect((yield* awaited(harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("keeps a chain when one commit ends its last task and creates new work below it", () =>
    Effect.runPromise(keepsChainOne));
});

const dropsWhatRejected = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(Rejected, { into: 0 }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            return { p, b, c: c.id };
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(tree.p)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              input: { into: tree.c },
            });
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  const baseline = sizes(harness);
  gate("rejected").resolve();
  yield* eventually(() => rejections.length > 0);
  yield* eventually(() => sizes(harness).dropQueue === 0);
  expect(sizes(harness)).toEqual(baseline);
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("drops what a rejected commit's chain load read, without a later publication", () =>
    Effect.runPromise(dropsWhatRejected));
});

const dropsWhatRead = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  let opened = yield* open(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(
    opened.root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "conversation" } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            const d = yield* awaited(
              tx.createTask(
                Hold,
                { name: "d" },
                { ownership: { kind: "conversation" }, conversationId: c.id },
              ),
            );
            return { b, d };
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* status(opened.harness, tree.b)).status === "completing";
      }),
    ),
  );
  yield* awaited(opened.harness.close(context));
  gates.clear();
  opened = yield* open(yield* awaited(openNodeSqliteStorage(path)));
  yield* awaited(opened.harness.inspect(context));
  expect(sizes(opened.harness).unloaded).toBe(0);
  gate("d").resolve();
  yield* awaited(opened.harness.waitForTask(tree.d, context));
  yield* awaited(opened.harness.waitForTask(tree.b, context));
  yield* eventually(() => sizes(opened.harness).dropQueue === 0);
  expect(sizes(opened.harness)).toMatchObject({ settled: 0, below: 0, unloaded: 0 });
  yield* awaited(opened.harness.close(context));
});

describe("scheduler retention", () => {
  it("drops what a read loaded after reopen, without a later publication", () =>
    Effect.runPromise(dropsWhatRead));
});

const withdrawsInputQueued = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, tree } = yield* endedLevelsTree();
  gate("a").resolve();
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  const c = (yield* awaited(harness.conversation(tree.c, context)))!;
  yield* awaited(
    c.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, tree.c))).run = { taskId: tree.keep, inputs: [] };
          }),
        ),
      context,
    ),
  );
  const queued = (yield* awaited(c.submit({ type: "input", content: "later" }, context))).id;
  yield* eventually(() => sizes(harness).dropQueue === 0);
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(tree.p)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              state: {
                status: "completing",
                outcome: { status: "failed", error: { message: "x" } },
              },
            });
          }),
        ),
      context,
    ),
  );
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (
          (yield* awaited((yield* awaited(harness.submission(queued, context)))!.status(context)))
            .status === "unanswered"
        );
      }),
    ),
  );
  expect(
    yield* awaited((yield* awaited(harness.submission(queued, context)))!.status(context)),
  ).toMatchObject({
    reason: "aborted",
  });
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("withdraws an input queued two ended levels below an owner whose intent appears later", () =>
    Effect.runPromise(withdrawsInputQueued));
});

const forgets20000 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
  const depth = 20_000;
  const baseline = sizes(harness);
  const { links, leaf } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const links: TaskId[] = [];
            let owner = yield* awaited(
              tx.createTask(Hold, { name: "link0" }, { ownership: { kind: "conversation" } }),
            );
            links.push(owner);
            for (const n of Array.from({ length: depth - 1 }, (_, i) => 1 + i)) {
              owner = yield* awaited(
                tx.createTask(
                  Hold,
                  { name: `link${n}` },
                  { ownership: { kind: "task", taskId: owner } },
                ),
              );
              links.push(owner);
            }
            const leaf = yield* awaited(
              tx.createTask(Hold, { name: "leaf" }, { ownership: { kind: "task", taskId: owner } }),
            );
            return { links, leaf };
          }),
        ),
      context,
    ),
  );
  for (let n = 0; n < depth; n++) gate(`link${n}`).resolve();
  gate("leaf").resolve();
  yield* awaited(harness.waitForTask(leaf, context));
  yield* awaited(harness.waitForTask(links[0]!, context));
  yield* awaited(harness.waitForIdle(context));
  expect(sizes(harness)).toEqual(baseline);
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it(
    "forgets a 20,000-deep chain of ended tasks without recursion",
    () => Effect.runPromise(forgets20000),
    60_000,
  );
});

const keepsNoMore = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let opened = yield* open(yield* awaited(openNodeSqliteStorage(path)));
  const parent = yield* awaited(
    opened.root.commit(
      (tx) => tx.createTask(Hold, { name: "parent" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  for (const n of Array.from({ length: 20 }, (_, i) => i))
    yield* subagentCycle(opened.harness, opened.root, parent, n);
  gate("parent").resolve();
  yield* awaited(opened.harness.waitForTask(parent, context));
  yield* awaited(opened.harness.waitForIdle(context));
  const ended = sizes(opened.harness);
  yield* awaited(opened.harness.close(context));
  opened = yield* open(yield* awaited(openNodeSqliteStorage(path)));
  yield* awaited(opened.harness.waitForIdle(context));
  expect(ended).toEqual(sizes(opened.harness));
  yield* awaited(opened.harness.close(context));
});

const doesNotScan = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = yield* awaited(openNodeSqliteStorage(yield* sqlitePath()));
  let scans = 0;
  const scan = storage.scanSubmissions.bind(storage);
  storage.scanSubmissions = (query, limit, cursor, scanContext) => {
    if (query.status === "queued") scans++;
    return scan(query, limit, cursor, scanContext);
  };
  const { harness, root } = yield* open(storage);
  const busy = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Hold, { name: "busy" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, root.id))).run = { taskId: busy, inputs: [] };
          }),
        ),
      context,
    ),
  );
  const before = scans;
  yield* awaited(root.submit({ type: "input", content: "queued" }, context));
  yield* Effect.sleep(20);
  expect(scans).toBe(before);
  gate("busy").resolve();
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("keeps no more after all work ended than a fresh reopen", () =>
    Effect.runPromise(keepsNoMore));

  it("does not scan queued submissions for an input when nothing cancels", () =>
    Effect.runPromise(doesNotScan));
});
