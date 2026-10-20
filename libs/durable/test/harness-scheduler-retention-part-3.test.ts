import { LiveDoc, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessSchedulerRetentionSupport from "./harness-scheduler-retention-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { Hold, directories, gate, gates, open, rejections, runs, sizes, sqlitePath, subagentCycle } =
  harnessSchedulerRetentionSupport;
const { removeDir } = platformSupport;
const { context } = sessionSupport;
const { eventually } = taskSupport;

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
            return { b, c: c.id, keep, p };
          }),
        ),
      context,
    ),
  );
  return { harness, tree };
});

const withdrawsInputQueuedStep1 = Effect.gen(function* () {
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
            (yield* awaited(tx.doc(LiveDoc, tree.c))).run = { inputs: [], taskId: tree.keep };
          }),
        ),
      context,
    ),
  );
  const queued = (yield* awaited(c.submit({ content: "later", type: "input" }, context))).id;
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
                outcome: { error: { message: "x" }, status: "failed" },
                status: "completing",
              },
            });
          }),
        ),
      context,
    ),
  );
  return { harness, queued, runPromise };
});

const withdrawsInputQueued = Effect.gen(function* () {
  const { runPromise, harness, queued } = yield* withdrawsInputQueuedStep1;
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
            const linksInner: TaskId[] = [];
            let owner = yield* awaited(
              tx.createTask(Hold, { name: "link0" }, { ownership: { kind: "conversation" } }),
            );
            linksInner.push(owner);
            for (const n of Array.from({ length: depth - 1 }, (_, i) => 1 + i)) {
              owner = yield* awaited(
                tx.createTask(
                  Hold,
                  { name: `link${n}` },
                  { ownership: { kind: "task", taskId: owner } },
                ),
              );
              linksInner.push(owner);
            }
            const leafInner = yield* awaited(
              tx.createTask(Hold, { name: "leaf" }, { ownership: { kind: "task", taskId: owner } }),
            );
            return { leaf: leafInner, links: linksInner };
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
            (yield* awaited(tx.doc(LiveDoc, root.id))).run = { inputs: [], taskId: busy };
          }),
        ),
      context,
    ),
  );
  const before = scans;
  yield* awaited(root.submit({ content: "queued", type: "input" }, context));
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
