import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type TaskId } from "@msa/durable";
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
  setEntriesDuring,
} from "./harness-ownership-support.ts";
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("ownership", () => {
  it("keeps a conversation busy while its owned foreground subtree has live work, holding the completed owner", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "owner");
    open("owner", "completed");
    await waitUntil(async () => (await status(harness, tree.owner)).status === "completing");
    const idle = root.waitForIdle(context);
    expect(await settled(idle)).toBe(false);
    expect(await settled(harness.waitForIdle(context))).toBe(false);
    open("owner.inner", "completed");
    await idle;
    await harness.waitForIdle(context);
    expect((await status(harness, tree.owner)).outcome?.status).toBe("completed");
    await harness.close(context);
  });

  it("holds an owner for work in a conversation its ended child task owns", async () => {
    const { harness, root } = await openHarness();
    const { owner, child, conversation } = await root.commit(async (tx) => {
      const owner = await tx.createTask(
        Hold,
        { name: "owner" },
        { ownership: { kind: "conversation" } },
      );
      const child = await tx.createTask(
        Hold,
        { name: "child" },
        { ownership: { kind: "task", taskId: owner } },
      );
      const conversation = await tx.createConversation({
        ownership: { kind: "task", taskId: child },
      });
      return { owner, child, conversation: conversation.id };
    }, context);
    open("child", "completed");
    expect((await harness.waitForTask(child, context)).state.outcome.status).toBe("completed");
    // The ended child's conversation still belongs to the owner above it.
    const handle = (await harness.conversation(conversation, context))!;
    await handle.commit(
      (tx) => tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
      context,
    );
    open("owner", "completed");
    await waitUntil(async () => (await status(harness, owner)).status === "completing");
    open("late", "completed");
    expect((await harness.waitForTask(owner, context)).state.outcome.status).toBe("completed");
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("cascades through ended tasks into an owned background subtree when aborting across background", async () => {
    const { harness, root } = await openHarness();
    // root conversation -> A -> B -> conversation -> background C -> D
    const tree = await root.commit(async (tx) => {
      const a = await tx.createTask(Hold, { name: "a" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: a } },
      );
      const conversation = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      const c = await tx.createTask(
        Hold,
        { name: "c" },
        { ownership: { kind: "conversation" }, conversationId: conversation.id, background: true },
      );
      const d = await tx.createTask(
        Hold,
        { name: "d" },
        { ownership: { kind: "task", taskId: c } },
      );
      return { a, b, c, d };
    }, context);
    open("b", "completed");
    open("a", "completed");
    expect((await harness.waitForTask(tree.a, context)).state.outcome.status).toBe("completed");
    await root.abort(context, { background: true });
    for await (const id of [tree.c, tree.d]) {
      expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("aborted");
    }
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("keeps ownership queries off finished subtrees", async () => {
    const { harness, root } = await openHarness();
    // Ended chains under a live owner, each ending in an empty owned conversation.
    const owner = await root.commit(
      (tx) => tx.createTask(Hold, { name: "owner" }, { ownership: { kind: "conversation" } }),
      context,
    );
    const chains = 50;
    const tasks: TaskId[] = [];
    for await (const n of Array.from({ length: chains }, (_, i) => i)) {
      const ids = await root.commit(async (tx) => {
        const first = await tx.createTask(
          Hold,
          { name: `c${n}.0` },
          { ownership: { kind: "task", taskId: owner } },
        );
        const second = await tx.createTask(
          Hold,
          { name: `c${n}.1` },
          { ownership: { kind: "task", taskId: first } },
        );
        await tx.createConversation({ ownership: { kind: "task", taskId: second } });
        return [first, second];
      }, context);
      tasks.push(...ids);
    }
    for (let n = 0; n < chains; n++) {
      open(`c${n}.1`, "completed");
      open(`c${n}.0`, "completed");
    }
    for await (const id of tasks) await harness.waitForTask(id, context);
    // Set iterations while the owner settles, a measure of the walks down: one through every ended task iterates
    // hundreds of entries; one over live work alone, none below the owner.
    const entries = await setEntriesDuring(async () => {
      open("owner", "completed");
      expect((await harness.waitForTask(owner, context)).state.outcome.status).toBe("completed");
    });
    expect(entries).toBeLessThan(chains);
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("tracks ownership chains deeper than the call stack", async () => {
    const { harness, root } = await openHarness();
    // 20,000 tasks, each owning the next, created in one commit above a live leaf; they end top-down and hold.
    const depth = 20_000;
    const { top, leaf } = await root.commit(async (tx) => {
      const top = await tx.createTask(
        Hold,
        { name: "top" },
        { ownership: { kind: "conversation" } },
      );
      let owner = top;
      for await (const n of Array.from({ length: depth }, (_, i) => i)) {
        owner = await tx.createTask(
          Hold,
          { name: `link${n}` },
          { ownership: { kind: "task", taskId: owner } },
        );
      }
      const leaf = await tx.createTask(
        Hold,
        { name: "leaf" },
        { ownership: { kind: "task", taskId: owner } },
      );
      return { top, leaf };
    }, context);
    for (let n = 0; n < depth; n++) open(`link${n}`, "completed");
    open("top", "completed");
    await waitUntil(async () => (await status(harness, top)).status === "completing");
    open("leaf", "completed");
    expect((await harness.waitForTask(leaf, context)).state.outcome.status).toBe("completed");
    expect((await harness.waitForTask(top, context)).state.outcome.status).toBe("completed");
    await harness.close(context);
  }, 60_000);
});

describe("ownership", () => {
  it("holds an owner for work a commit creates below ended tasks loaded from storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "msa-durable-ownership-"));
    directories.add(directory);
    const path = join(directory, "session.sqlite");
    let opened = await openHarness(await openNodeSqliteStorage(path));
    // Live P owns B, which owns A, which owns the empty conversation C; B and A end.
    const tree = await opened.root.commit(async (tx) => {
      const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const a = await tx.createTask(
        Hold,
        { name: "a" },
        { ownership: { kind: "task", taskId: b } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: a } });
      return { p, a, b, c: c.id };
    }, context);
    open("a", "completed");
    open("b", "completed");
    await opened.harness.waitForTask(tree.a, context);
    await opened.harness.waitForTask(tree.b, context);
    await opened.harness.close(context);
    // After reopen, B and A are known only once a chain load reads them.
    opened = await openHarness(await openNodeSqliteStorage(path));
    const c = (await opened.harness.conversation(tree.c, context))!;
    const d = await c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    );
    open("p", "completed");
    await waitUntil(async () => (await status(opened.harness, tree.p)).status === "completing");
    open("d", "completed");
    expect((await opened.harness.waitForTask(d, context)).state.outcome.status).toBe("completed");
    expect((await opened.harness.waitForTask(tree.p, context)).state.outcome.status).toBe(
      "completed",
    );
    await opened.harness.close(context);
  });
});

describe("ownership", () => {
  it("holds an owner for work created later below ended tasks, without a reopen", async () => {
    const { harness, root } = await openHarness();
    // Live P owns B, which owns A, which owns the empty conversation C; B and A end, C stays.
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const a = await tx.createTask(
        Hold,
        { name: "a" },
        { ownership: { kind: "task", taskId: b } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: a } });
      return { p, a, b, c: c.id };
    }, context);
    open("a", "completed");
    open("b", "completed");
    await harness.waitForTask(tree.b, context);
    const c = (await harness.conversation(tree.c, context))!;
    const d = await c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    );
    open("p", "completed");
    await waitUntil(async () => (await status(harness, tree.p)).status === "completing");
    open("d", "completed");
    expect((await harness.waitForTask(d, context)).state.outcome.status).toBe("completed");
    expect((await harness.waitForTask(tree.p, context)).state.outcome.status).toBe("completed");
    await harness.close(context);
  });
});
