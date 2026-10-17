import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
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
  busy,
} from "./harness-ownership-support.ts";
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// A write that affects model context, so it queues while busy; a data-only write would be appended at once.
function queuedNote(text: string) {
  return { kind: "note", model: [{ role: "user", content: text, timestamp: 0 }] } as const;
}

describe("ownership", () => {
  it("stops idle traversal at a background owner", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "background", { background: true });
    await root.waitForIdle(context);
    await harness.waitForIdle(context);
    // The background child is its own scope.
    const child = (await harness.conversation(tree.child, context))!;
    expect(await settled(child.waitForIdle(context))).toBe(false);
    await child.abort(context);
    await harness.close(context);
  });

  it("cascades an abort mark to the owned foreground subtree and withdraws its queued inputs", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "owner");
    const nested = await harness.conversation(tree.child, context);
    const deeper = await ownedChild(nested!, "deeper");
    const shielded = await ownedChild(nested!, "shielded", { background: true });
    // Busy conversations queue submissions; the inner task stands in for the child's run.
    await busy(nested!, tree.inner);
    const queued = (await nested!.submit({ type: "input", content: "later" }, context)).id;
    expect(await harness.abortTask(tree.owner, context)).toBe("marked");
    for await (const id of [tree.owner, tree.inner, deeper.owner, deeper.inner]) {
      expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("aborted");
    }
    // A nested background owner is a boundary.
    expect((await status(harness, shielded.owner)).status).not.toBe("terminal");
    expect((await status(harness, shielded.inner)).status).not.toBe("terminal");
    expect(await (await harness.submission(queued, context))!.status(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    await harness.abortTask(shielded.owner, context);
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("cascades a failed owner but not a completed one", async () => {
    const { harness, root } = await openHarness();
    const failed = await ownedChild(root, "failed");
    const completedTree = await ownedChild(root, "done");
    open("failed", "failed");
    open("done", "completed");
    expect((await harness.waitForTask(failed.inner, context)).state.outcome.status).toBe("aborted");
    expect((await harness.waitForTask(failed.owner, context)).state.outcome.status).toBe("failed");
    await waitUntil(
      async () => (await status(harness, completedTree.owner)).status === "completing",
    );
    expect((await status(harness, completedTree.inner)).status).not.toBe("terminal");
    open("done.inner", "completed");
    expect((await harness.waitForTask(completedTree.owner, context)).state.outcome.status).toBe(
      "completed",
    );
    await harness.close(context);
  });

  it("aborts a background task directly with its ordinary subtree", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "background", { background: true });
    await harness.abortTask(tree.owner, context);
    expect((await harness.waitForTask(tree.inner, context)).state.outcome.status).toBe("aborted");
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("aborts a conversation: queued inputs withdrawn, writes kept, foreground work aborted, background kept", async () => {
    const { harness, root } = await openHarness();
    const foreground = await ownedChild(root, "foreground");
    const background = await ownedChild(root, "background", { background: true });
    await busy(root, foreground.owner);
    const input = (await root.submit({ type: "input", content: "later" }, context)).id;
    const write = (await root.submit({ type: "write", entry: queuedNote("w") }, context)).id;
    await root.abort(context);
    for await (const id of [foreground.owner, foreground.inner]) {
      expect((await status(harness, id)).status).toBe("terminal");
    }
    expect((await status(harness, background.owner)).status).not.toBe("terminal");
    expect((await status(harness, background.inner)).status).not.toBe("terminal");
    expect(await (await harness.submission(input, context))!.status(context)).toMatchObject({
      reason: "aborted",
    });
    expect((await (await harness.submission(write, context))!.status(context)).status).toBe(
      "queued",
    );
    await harness.abortTask(background.owner, context);
    await harness.close(context);
  });

  it("aborts work created below a held failed owner, but not below a terminal one", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "owner", { slowInner: true });
    open("owner", "failed");
    await waitUntil(async () => (await harness.getTask(tree.inner, context))!.abortRequested);
    expect((await status(harness, tree.owner)).status).toBe("completing");
    const child = (await harness.conversation(tree.child, context))!;
    const create = (name: string) =>
      child.commit(
        (tx) => tx.createTask(Hold, { name }, { ownership: { kind: "conversation" } }),
        context,
      );
    const during = await create("during");
    expect((await harness.waitForTask(during, context)).state.outcome.status).toBe("aborted");
    open("abort.owner.inner", "completed");
    expect((await harness.waitForTask(tree.owner, context)).state.outcome.status).toBe("failed");
    // A terminal owner never cascades: interrogating its conversation runs normally.
    const after = await create("after");
    open("after", "completed");
    expect((await harness.waitForTask(after, context)).state.outcome.status).toBe("completed");
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("withdraws queued inputs below the aborted task but keeps its own conversation's queue and queued writes", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "owner");
    const child = (await harness.conversation(tree.child, context))!;
    await busy(root, tree.owner);
    await busy(child, tree.inner);
    const own = (await root.submit({ type: "input", content: "own" }, context)).id;
    const below = (await child.submit({ type: "input", content: "below" }, context)).id;
    const write = (await child.submit({ type: "write", entry: queuedNote("w") }, context)).id;
    await harness.abortTask(tree.owner, context);
    await harness.waitForTask(tree.inner, context);
    const statusOf = async (id: typeof own) =>
      (await (await harness.submission(id, context))!.status(context)).status;
    expect(await statusOf(own)).toBe("queued");
    expect(await statusOf(below)).toBe("unanswered");
    expect(await statusOf(write)).toBe("queued");
    await harness.close(context);
  });

  it("keeps a nested background owner's subtree when its cancelled background owner is aborted", async () => {
    const { harness, root } = await openHarness();
    const outer = await ownedChild(root, "outer", { background: true });
    const inner = await ownedChild((await harness.conversation(outer.child, context))!, "inner", {
      background: true,
    });
    await harness.abortTask(outer.owner, context);
    expect((await harness.waitForTask(outer.inner, context)).state.outcome.status).toBe("aborted");
    expect((await status(harness, inner.owner)).status).not.toBe("terminal");
    expect((await status(harness, inner.inner)).status).not.toBe("terminal");
    await harness.abortTask(inner.owner, context);
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("decides idle after reopen from owner edges it has to load first", async () => {
    const directory = await mkdtemp(join(tmpdir(), "msa-durable-ownership-"));
    directories.add(directory);
    const path = join(directory, "session.sqlite");
    let opened = await openHarness(await openNodeSqliteStorage(path));
    const foreground = await ownedChild(opened.root, "fg");
    const deeper = await ownedChild(
      (await opened.harness.conversation(foreground.child, context))!,
      "fg2",
    );
    const background = await ownedChild(opened.root, "bg", { background: true });
    open("fg", "completed");
    open("fg2", "completed");
    // Both owners hold their outcomes while the work below them runs.
    await waitUntil(
      async () => (await status(opened.harness, foreground.owner)).status === "completing",
    );
    await waitUntil(
      async () => (await status(opened.harness, deeper.owner)).status === "completing",
    );
    await opened.harness.close(context);

    opened = await openHarness(await openNodeSqliteStorage(path));
    // Two levels below completed foreground owners, the inner tasks keep the root busy.
    expect(await settled(opened.root.waitForIdle(context))).toBe(false);
    expect(await settled(opened.harness.waitForIdle(context))).toBe(false);
    open("fg.inner", "completed");
    open("fg2.inner", "completed");
    // The background subtree does not count.
    await opened.root.waitForIdle(context);
    await opened.harness.waitForIdle(context);
    expect((await status(opened.harness, foreground.owner)).status).toBe("terminal");
    expect((await status(opened.harness, background.inner)).status).not.toBe("terminal");
    await opened.harness.abortTask(background.owner, context);
    await opened.harness.close(context);
  });
});
