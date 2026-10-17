import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSession, defineTask, type TaskId } from "@msa/durable";
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
  Waiter,
  busy,
} from "./harness-ownership-support.ts";
import { context } from "./session-support.ts";

/** Never registered: aborting it can only orphan it. */
const Unregistered = defineTask<{ name: string }, { phase: "hold" }, null>({
  name: "test.unregistered",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: { hold: async () => {} },
  abort: async () => {},
});

afterEach(async () => {
  gates.clear();
  runs.clear();
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function orphanBelowOwner() {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-ownership-"));
  directories.add(directory);
  const path = join(directory, "session.sqlite");
  // Without a Harness, nothing derives marks: a cancelled owner with a live task below it.
  const session = createSession(await openNodeSqliteStorage(path));
  const tree = await session.commit(async (tx) => {
    const root = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const owner = await tx.createTask(
      Hold,
      { name: "gone" },
      { ownership: { kind: "conversation" }, conversationId: root.id },
    );
    const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
    return {
      owner,
      inner: await tx.createTask(
        Hold,
        { name: "orphan" },
        { ownership: { kind: "conversation" }, conversationId: child.id },
      ),
    };
  }, context);
  return { path, session, tree };
}

describe("ownership", () => {
  for (const [label, abortRequested, state] of [
    [
      "a held failed owner",
      false,
      { status: "completing", outcome: { status: "failed", error: { message: "crash" } } },
    ],
    ["an abort-marked owner", true, { status: "pending", checkpoint: { phase: "hold" } }],
  ] as const) {
    it(`derives marks a crash left unapplied below ${label} at open`, async () => {
      const { path, session, tree } = await orphanBelowOwner();
      await session.commit(async (tx) => {
        const record = (await tx.task(tree.owner))!;
        (tx as unknown as { setTask(value: unknown): void }).setTask({
          ...record,
          abortRequested,
          state,
        });
      }, context);
      await session.close(context);

      const { harness } = await openHarness(await openNodeSqliteStorage(path));
      expect((await harness.waitForTask(tree.inner, context)).state.outcome.status).toBe("aborted");
      // The owner finishes only after the work below it.
      const outcome = (await harness.waitForTask(tree.owner, context)).state.outcome.status;
      expect(outcome).toBe(abortRequested ? "aborted" : "failed");
      await harness.close(context);
    });
  }

  it("withdraws an input queued below a held failed owner after its cascade", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "owner", { slowInner: true });
    const child = (await harness.conversation(tree.child, context))!;
    // The inner task stands in for the child's run, which stays busy after the cascade.
    await busy(child, tree.inner);
    open("owner", "failed");
    await waitUntil(async () => (await harness.getTask(tree.inner, context))!.abortRequested);
    const late = await child.submit({ type: "input", content: "late" }, context);
    expect(await late.wait(context)).toMatchObject({ status: "unanswered", reason: "aborted" });
    open("abort.owner.inner", "completed");
    await harness.waitForTask(tree.owner, context);
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("marks work admitted after reopen below a cancelled owner whose edge was not loaded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "msa-durable-ownership-"));
    directories.add(directory);
    const path = join(directory, "session.sqlite");
    let opened = await openHarness(await openNodeSqliteStorage(path));
    const tree = await ownedChild(opened.root, "owner", { slowOwner: true });
    open("owner.inner", "completed");
    await opened.harness.waitForTask(tree.inner, context);
    // The owner stays live and cancelled in its slow abort handler.
    await opened.harness.abortTask(tree.owner, context);
    await opened.harness.close(context);

    // The child is empty at open, so nothing loads its edge until new work arrives.
    opened = await openHarness(await openNodeSqliteStorage(path));
    const child = (await opened.harness.conversation(tree.child, context))!;
    const late = await child.commit(
      (tx) => tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
      context,
    );
    expect((await opened.harness.waitForTask(late, context)).state.outcome.status).toBe("aborted");
    open("abort.owner", "completed");
    expect((await opened.harness.waitForTask(tree.owner, context)).state.outcome.status).toBe(
      "aborted",
    );
    await opened.harness.close(context);
  });
});

describe("ownership", () => {
  it("cascades from an owner the scheduler orphans", async () => {
    const { harness, root } = await openHarness();
    const { owner, inner } = await root.commit(async (tx) => {
      const owner = await tx.createTask(
        Unregistered,
        { name: "unregistered" },
        { ownership: { kind: "conversation" } },
      );
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
      return {
        owner,
        inner: await tx.createTask(
          Hold,
          { name: "below" },
          { ownership: { kind: "conversation" }, conversationId: child.id },
        ),
      };
    }, context);
    expect(await harness.abortTask(owner, context)).toBe("marked");
    expect((await harness.waitForTask(owner, context)).state.outcome).toEqual({
      status: "orphaned",
      reason: "missing_task",
    });
    expect((await harness.waitForTask(inner, context)).state.outcome.status).toBe("aborted");
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("cancels only the caller's wait, never the shared work", async () => {
    const { harness, root } = await openHarness();
    const tree = await ownedChild(root, "owner");
    const waiting = new AbortController();
    const idle = root.waitForIdle({ ...context, abortSignal: waiting.signal });
    waiting.abort(new Error("stop waiting"));
    await expect(idle).rejects.toThrow("stop waiting");
    expect((await status(harness, tree.inner)).status).not.toBe("terminal");

    // Cancelling an abort after its commit leaves the marks in place.
    const slow = await ownedChild(root, "slow");
    await root.commit(async (tx) => {
      const record = (await tx.task(slow.owner))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...record,
        input: { name: "slow", slowAbort: true },
      });
    }, context);
    const aborting = new AbortController();
    const abort = root.abort({ ...context, abortSignal: aborting.signal });
    await waitUntil(async () => (await harness.getTask(slow.owner, context))!.abortRequested);
    aborting.abort(new Error("stop aborting"));
    await expect(abort).rejects.toThrow("stop aborting");
    open("abort.slow", "completed");
    for await (const id of [tree.owner, tree.inner, slow.owner, slow.inner]) {
      expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("aborted");
    }
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("aborts a waiting child whose awaited task completes in the commit that marks its owner", async () => {
    const { harness, root } = await openHarness();
    const { owner, dependency, blocked } = await root.commit(async (tx) => {
      const owner = await tx.createTask(
        Hold,
        { name: "owner" },
        { ownership: { kind: "conversation" } },
      );
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
      const dependency = await tx.createTask(
        Hold,
        { name: "dependency" },
        { ownership: { kind: "conversation" } },
      );
      const blocked = await tx.createTask(
        Waiter,
        { on: [dependency] },
        { ownership: { kind: "conversation" }, conversationId: child.id },
      );
      return { owner, dependency, blocked };
    }, context);
    await waitUntil(() => Promise.resolve(runs.get("dependency") === 1 && runs.get("owner") === 1));
    await waitUntil(async () => (await status(harness, blocked)).status === "waiting");
    // One commit completes the dependency and marks the owner.
    await root.commit(async (tx) => {
      const setTask = (value: unknown) =>
        (tx as unknown as { setTask(value: unknown): void }).setTask(value);
      const completedDependency = (await tx.task(dependency))!;
      const marked = (await tx.task(owner))!;
      setTask({
        ...completedDependency,
        state: { status: "terminal", outcome: { status: "completed", result: null } },
      });
      setTask({ ...marked, abortRequested: true });
    }, context);
    expect((await harness.waitForTask(blocked, context)).state.outcome.status).toBe("aborted");
    await harness.close(context);
  });
});

describe("ownership", () => {
  it("applies marks found through an edge loaded after reopen once a failed cascade commit is reopened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "msa-durable-ownership-"));
    directories.add(directory);
    const path = join(directory, "session.sqlite");
    let opened = await openHarness(await openNodeSqliteStorage(path));
    const tree = await ownedChild(opened.root, "owner", { slowOwner: true });
    open("owner.inner", "completed");
    await opened.harness.waitForTask(tree.inner, context);
    await opened.harness.abortTask(tree.owner, context);
    await opened.harness.close(context);

    const storage = await openNodeSqliteStorage(path);
    let rejectMark: TaskId | undefined;
    const commit = storage.commit.bind(storage);
    storage.commit = (writes, ctx) => {
      if (
        writes.some(
          (write) =>
            write.type === "task" && write.value.id === rejectMark && write.value.abortRequested,
        )
      ) {
        rejectMark = undefined;
        return Promise.reject(new Error("disk gone"));
      }
      return Promise.resolve(commit(writes, ctx));
    };
    opened = await openHarness(storage);
    const child = (await opened.harness.conversation(tree.child, context))!;
    const late = await child.commit(async (tx) => {
      const id = await tx.createTask(
        Hold,
        { name: "late" },
        { ownership: { kind: "conversation" } },
      );
      rejectMark = id;
      return id;
    }, context);
    // The failed cascade commit fails the Harness. `closed` settles once its invocations have ended, and the owner's
    // abort handler ignores its signal: let it return.
    open("abort.owner", "completed");
    expect(await opened.harness.closed).toMatchObject({ reason: "failed" });
    await opened.harness.close(context);
    // Reopening derives the mark again.
    opened = await openHarness(await openNodeSqliteStorage(path));
    expect((await opened.harness.waitForTask(late, context)).state.outcome.status).toBe("aborted");
    await opened.harness.close(context);
  });
});
