import { rm } from "node:fs/promises";

import { type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

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
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function openOwnedTree() {
  const { harness, root } = await openHarness();
  // Live P owns B, which owns A, which owns conversation C with background Z and, later, foreground D.
  const tree = await root.commit(async (tx) => {
    const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
    const b = await tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } });
    const a = await tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: b } });
    const c = await tx.createConversation({ ownership: { kind: "task", taskId: a } });
    const z = await tx.createTask(
      Hold,
      { name: "z" },
      { ownership: { kind: "conversation" }, conversationId: c.id, background: true },
    );
    return { p, a, b, c: c.id, z };
  }, context);
  return { harness, tree };
}

async function openHeldSiblings() {
  const { harness, root } = await openHarness();
  // Top holds 1000 held children, each holding one live leaf; the leaves end in one commit.
  const count = 1000;
  const { top, leaves } = await root.commit(async (tx) => {
    const top = await tx.createTask(Hold, { name: "top" }, { ownership: { kind: "conversation" } });
    const siblings: TaskId[] = [];
    for await (const n of Array.from({ length: count }, (_, i) => i)) {
      siblings.push(
        await tx.createTask(Hold, { name: `s${n}` }, { ownership: { kind: "task", taskId: top } }),
      );
    }
    // Leaves in reverse sibling order: the last sibling is freed first, so a holder checked after each freed sibling
    // would scan the siblings already finalized each time.
    const leaves: TaskId[] = [];
    for await (const n of Array.from({ length: count }, (_, i) => count - 1 - i)) {
      const owner = siblings[n]!;
      leaves.push(
        await tx.createTask(
          Hold,
          { name: `l${n}` },
          { ownership: { kind: "task", taskId: owner } },
        ),
      );
    }
    return { top, leaves };
  }, context);
  return { harness, root, count, top, leaves };
}

// Live P owns `depth` ended tasks in a chain, the last owning conversation C, empty when they ended. Work started in C
// later is still P's: every case below must reach it through the ended tasks.
async function endedBridge(depth: number) {
  const { harness, root } = await openHarness();
  const tree = await root.commit(async (tx) => {
    const p = await tx.createTask(
      Hold,
      { name: "p", slowAbort: true },
      { ownership: { kind: "conversation" } },
    );
    const links: TaskId[] = [];
    let owner = p;
    for await (const n of Array.from({ length: depth }, (_, i) => i)) {
      owner = await tx.createTask(
        Hold,
        { name: `link${n}` },
        { ownership: { kind: "task", taskId: owner } },
      );
      links.push(owner);
    }
    const c = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
    return { p, links, c: c.id };
  }, context);
  for (let n = depth - 1; n >= 0; n--) open(`link${n}`, "completed");
  for await (const id of tree.links) await harness.waitForTask(id, context);
  const c = (await harness.conversation(tree.c, context))!;
  const create = (name: string) =>
    c.commit(
      (tx) => tx.createTask(Hold, { name }, { ownership: { kind: "conversation" } }),
      context,
    );
  return { harness, root, p: tree.p, create };
}

describe("ownership", () => {
  for (const depth of [2, 5]) {
    it(`aborts work below ${depth} ended tasks with their live owner, which waits for it`, async () => {
      const { harness, p, create } = await endedBridge(depth);
      const d = await create("d");
      await harness.abortTask(p, context);
      expect((await harness.waitForTask(d, context)).state.outcome.status).toBe("aborted");
      // P's abort handler ran only after D ended.
      open("abort.p", "completed");
      expect((await harness.waitForTask(p, context)).state.outcome.status).toBe("aborted");
      await harness.close(context);
    });

    it(`keeps the root busy and aborts with it work below ${depth} ended tasks`, async () => {
      const { harness, root, p, create } = await endedBridge(depth);
      open("p", "completed");
      await harness.waitForTask(p, context);
      // P has ended: D and D2 hang below ended tasks only, and are still the root conversation's work.
      const d = await create("d");
      const d2 = await create("d2");
      expect(await settled(root.waitForIdle(context))).toBe(false);
      expect(await settled(harness.waitForIdle(context))).toBe(false);
      await root.abort(context);
      for await (const id of [d, d2])
        expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("aborted");
      await harness.close(context);
    });
  }
});

describe("ownership", () => {
  it("reaches work below ended tasks across two owned conversations", async () => {
    const { harness, root } = await openHarness();
    // Live P -> ended B -> conversation C -> ended X -> ended A -> conversation C2; work starts in C2 later. X owns no
    // conversation, only the task A, so only owning a known task keeps it.
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      const x = await tx.createTask(
        Hold,
        { name: "x" },
        { ownership: { kind: "conversation" }, conversationId: c.id },
      );
      const a = await tx.createTask(
        Hold,
        { name: "a" },
        { ownership: { kind: "task", taskId: x } },
      );
      const c2 = await tx.createConversation({ ownership: { kind: "task", taskId: a } });
      return { p, b, x, c2: c2.id };
    }, context);
    open("a", "completed");
    open("x", "completed");
    open("b", "completed");
    await harness.waitForTask(tree.b, context);
    const c2 = (await harness.conversation(tree.c2, context))!;
    const d = await c2.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    );
    open("p", "completed");
    await waitUntil(async () => (await status(harness, tree.p)).status === "completing");
    expect(await settled(root.waitForIdle(context))).toBe(false);
    await root.abort(context);
    expect((await harness.waitForTask(d, context)).state.outcome.status).toBe("aborted");
    expect((await harness.waitForTask(tree.p, context)).state.outcome.status).toBe("completed");
    await harness.close(context);
  });
});

describe("ownership", () => {
  for (const ending of ["completes", "is aborted"] as const) {
    it(`frees an owner that ${ending} once the last work below ended tasks ends after a background task there`, async () => {
      const { harness, tree } = await openOwnedTree();
      open("a", "completed");
      open("b", "completed");
      await harness.waitForTask(tree.b, context);
      const c = (await harness.conversation(tree.c, context))!;
      const d = await c.commit(
        (tx) =>
          tx.createTask(
            Hold,
            { name: "d", slowAbort: true },
            { ownership: { kind: "conversation" } },
          ),
        context,
      );
      if (ending === "completes") {
        open("p", "completed");
        await waitUntil(async () => (await status(harness, tree.p)).status === "completing");
      } else {
        // P waits for D's abort before its own abort handler runs.
        await harness.abortTask(tree.p, context);
        await waitUntil(async () => (await harness.getTask(d, context))!.abortRequested);
      }
      // Z ends first, D last.
      open("z", "completed");
      await harness.waitForTask(tree.z, context);
      if (ending === "completes") open("d", "completed");
      else open("abort.d", "completed");
      await harness.waitForTask(d, context);
      const expected = ending === "completes" ? "completed" : "aborted";
      expect((await harness.waitForTask(tree.p, context)).state.outcome.status).toBe(expected);
      await harness.close(context);
    });
  }
});

describe("ownership", () => {
  it("finalizes many held siblings that end together in one pass", async () => {
    const { harness, root, count, top, leaves } = await openHeldSiblings();
    for (let n = 0; n < count; n++) open(`s${n}`, "completed");
    open("top", "completed");
    await waitUntil(async () => (await status(harness, top)).status === "completing");
    await root.commit(async (tx) => {
      // Reads before the first write. Ended last to first, so a holder checked after each sibling would scan the ones
      // already finalized every time.
      const records = [];
      for await (const id of leaves) records.push((await tx.task(id))!);
      for (const record of records) {
        (tx as unknown as { setTask(value: unknown): void }).setTask({
          ...record,
          state: { status: "terminal", outcome: { status: "completed", result: null } },
        });
      }
    }, context);
    // Set entries iterated while it all finalizes: one pass is linear, a recheck per sibling quadratic (~500,000).
    const entries = await setEntriesDuring(async () => {
      expect((await harness.waitForTask(top, context)).state.outcome.status).toBe("completed");
    });
    expect(entries).toBeLessThan(count * 20);
    await harness.close(context);
  });

  // Pins the Transaction rule that a conversation cannot be created in the commit that ends its owner task.
  it("rejects a conversation created in the commit that ends its owner task", async () => {
    const { harness, root } = await openHarness();
    const spawner = await root.commit(
      (tx) => tx.createTask(Spawner, { name: "spawned" }, { ownership: { kind: "conversation" } }),
      context,
    );
    expect((await harness.waitForTask(spawner, context)).state.outcome).toEqual({
      status: "faulted",
      error: {
        message: expect.stringMatching(
          new RegExp(`^Conversation owner task ${spawner} is (completing|terminal)$`, "u"),
        ),
      },
    });
    await harness.close(context);
  });
});
