import { rm } from "node:fs/promises";

import { LiveDoc, type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
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
import { context } from "./session-support.ts";
import { eventually } from "./task-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  rejections.length = 0;
  for await (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function endedLevelsTree() {
  const { harness, root } = await open();
  // Live P -> ended B -> ended A -> conversation C with no task, and a live child keeping P holding.
  const tree = await root.commit(async (tx) => {
    const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
    const b = await tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } });
    const a = await tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: b } });
    const c = await tx.createConversation({ ownership: { kind: "task", taskId: a } });
    const keep = await tx.createTask(
      Hold,
      { name: "keep" },
      { ownership: { kind: "task", taskId: p } },
    );
    return { p, b, c: c.id, keep };
  }, context);
  return { harness, tree };
}

describe("scheduler retention", () => {
  it("keeps a chain when one commit ends its last task and creates new work below it", async () => {
    const { harness, root } = await open();
    // Live P -> ended B -> conversation C with background task `old`, which keeps the chain known without holding B.
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      const old = await tx.createTask(
        Hold,
        { name: "old" },
        { ownership: { kind: "conversation" }, conversationId: c.id, background: true },
      );
      return { p, b, c: c.id, old };
    }, context);
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    // One commit: the old task ends, which leaves nothing live below B, and a replacement starts in C.
    const replacement = await harness.commit(async (tx) => {
      const old = (await tx.task(tree.old))!;
      const id = await tx.createTask(
        Hold,
        { name: "new" },
        { ownership: { kind: "conversation" }, conversationId: tree.c },
      );
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...old,
        state: { status: "terminal", outcome: { status: "completed", result: null } },
      });
      return id;
    }, context);
    // The chain stayed known through the publication, so P holds for the replacement.
    gate("p").resolve();
    await eventually(async () => (await status(harness, tree.p)).status === "completing");
    gate("new").resolve();
    await harness.waitForTask(replacement, context);
    expect((await harness.waitForTask(tree.p, context)).state.outcome.status).toBe("completed");
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("drops what a rejected commit's chain load read, without a later publication", async () => {
    const { harness, root } = await open();
    // Live P owns ended B, which owns conversation C: forgotten. P's terminal commit stages work in C, which loads C's
    // chain, and a child of P, which the Transaction rejects, as P is ending.
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(Rejected, { into: 0 }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      return { p, b, c: c.id };
    }, context);
    await root.commit(async (tx) => {
      const record = (await tx.task(tree.p))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...record,
        input: { into: tree.c },
      });
    }, context);
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    const baseline = sizes(harness);
    gate("rejected").resolve();
    await eventually(() => rejections.length > 0);
    // The rejected commit published nothing; the sweep job still cleans up what its chain load read.
    await eventually(() => sizes(harness).dropQueue === 0);
    expect(sizes(harness)).toEqual(baseline);
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("drops what a read loaded after reopen, without a later publication", async () => {
    const path = await sqlitePath();
    let opened = await open(await openNodeSqliteStorage(path));
    // A live task D in conversation C, owned by ended B: after reopen D's chain is not loaded.
    const tree = await opened.root.commit(async (tx) => {
      const b = await tx.createTask(Hold, { name: "b" }, { ownership: { kind: "conversation" } });
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      const d = await tx.createTask(
        Hold,
        { name: "d" },
        { ownership: { kind: "conversation" }, conversationId: c.id },
      );
      return { b, d };
    }, context);
    gate("b").resolve();
    await eventually(async () => (await status(opened.harness, tree.b)).status === "completing");
    await opened.harness.close(context);
    gates.clear();
    opened = await open(await openNodeSqliteStorage(path));
    await opened.harness.inspect(context);
    // D is still live, so its chain stays; once D ends, everything below the root goes, published or not.
    expect(sizes(opened.harness).unloaded).toBe(0);
    gate("d").resolve();
    await opened.harness.waitForTask(tree.d, context);
    await opened.harness.waitForTask(tree.b, context);
    await eventually(() => sizes(opened.harness).dropQueue === 0);
    expect(sizes(opened.harness)).toMatchObject({ settled: 0, below: 0, unloaded: 0 });
    await opened.harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("withdraws an input queued two ended levels below an owner whose intent appears later", async () => {
    const { harness, tree } = await endedLevelsTree();
    gate("a").resolve();
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    const c = (await harness.conversation(tree.c, context))!;
    await c.commit(async (tx) => {
      (await tx.doc(LiveDoc, tree.c)).run = { taskId: tree.keep, inputs: [] };
    }, context);
    // Queued while nothing cancels: no withdrawal scan.
    const queued = (await c.submit({ type: "input", content: "later" }, context)).id;
    await eventually(() => sizes(harness).dropQueue === 0);
    // P fails while its child runs: it holds the failed outcome, which is cancellation intent.
    await harness.commit(async (tx) => {
      const record = (await tx.task(tree.p))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...record,
        state: { status: "completing", outcome: { status: "failed", error: { message: "x" } } },
      });
    }, context);
    await eventually(
      async () =>
        (await (await harness.submission(queued, context))!.status(context)).status ===
        "unanswered",
    );
    expect(await (await harness.submission(queued, context))!.status(context)).toMatchObject({
      reason: "aborted",
    });
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("forgets a 20,000-deep chain of ended tasks without recursion", async () => {
    const { harness, root } = await open();
    const depth = 20_000;
    const baseline = sizes(harness);
    const { links, leaf } = await root.commit(async (tx) => {
      const links: TaskId[] = [];
      let owner = await tx.createTask(
        Hold,
        { name: "link0" },
        { ownership: { kind: "conversation" } },
      );
      links.push(owner);
      for await (const n of Array.from({ length: depth - 1 }, (_, i) => 1 + i)) {
        owner = await tx.createTask(
          Hold,
          { name: `link${n}` },
          { ownership: { kind: "task", taskId: owner } },
        );
        links.push(owner);
      }
      const leaf = await tx.createTask(
        Hold,
        { name: "leaf" },
        { ownership: { kind: "task", taskId: owner } },
      );
      return { links, leaf };
    }, context);
    for (let n = 0; n < depth; n++) gate(`link${n}`).resolve();
    gate("leaf").resolve();
    await harness.waitForTask(leaf, context);
    await harness.waitForTask(links[0]!, context);
    await harness.waitForIdle(context);
    expect(sizes(harness)).toEqual(baseline);
    await harness.close(context);
  }, 60_000);
});

describe("scheduler retention", () => {
  it("keeps no more after all work ended than a fresh reopen", async () => {
    const path = await sqlitePath();
    let opened = await open(await openNodeSqliteStorage(path));
    const parent = await opened.root.commit(
      (tx) => tx.createTask(Hold, { name: "parent" }, { ownership: { kind: "conversation" } }),
      context,
    );
    for await (const n of Array.from({ length: 20 }, (_, i) => i))
      await subagentCycle(opened.harness, opened.root, parent, n);
    gate("parent").resolve();
    await opened.harness.waitForTask(parent, context);
    await opened.harness.waitForIdle(context);
    const ended = sizes(opened.harness);
    await opened.harness.close(context);
    opened = await open(await openNodeSqliteStorage(path));
    await opened.harness.waitForIdle(context);
    expect(ended).toEqual(sizes(opened.harness));
    await opened.harness.close(context);
  });

  it("does not scan queued submissions for an input when nothing cancels", async () => {
    const storage = await openNodeSqliteStorage(await sqlitePath());
    let scans = 0;
    const scan = storage.scanSubmissions.bind(storage);
    storage.scanSubmissions = (query, limit, cursor, scanContext) => {
      if (query.status === "queued") scans++;
      return scan(query, limit, cursor, scanContext);
    };
    const { harness, root } = await open(storage);
    const busy = await root.commit(
      (tx) => tx.createTask(Hold, { name: "busy" }, { ownership: { kind: "conversation" } }),
      context,
    );
    await root.commit(async (tx) => {
      (await tx.doc(LiveDoc, root.id)).run = { taskId: busy, inputs: [] };
    }, context);
    const before = scans;
    await root.submit({ type: "input", content: "queued" }, context);
    // Let any reconcile it would cause run.
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(scans).toBe(before);
    gate("busy").resolve();
    await harness.close(context);
  });
});
