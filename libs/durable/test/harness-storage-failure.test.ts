import type { Context } from "@msa/chord";
import { defineTask, LiveDoc, StorageRequestError, type TaskId } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { describe, expect, it } from "vite-plus/test";

import {
  FailingCalls,
  running,
  signals,
  Waiting,
  started,
} from "./harness-storage-failure-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred, openTasks } from "./task-support.ts";

describe("a failed Storage call", () => {
  it("ends everything with the first error: the call, later calls, waits, watches, streams, running tasks", async () => {
    const storage = new ControlledStorage();
    const { harness, root, reports } = await started(storage);
    const id = await root.commit(
      (tx) => tx.createTask(Waiting, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await running(harness, id);
    const task = harness.waitForTask(id, context);
    const idle = harness.waitForIdle(context);
    const watch = (await harness.watchDoc(LiveDoc, root.id, context))!;
    const stream = await watchEvents(harness, root.id, context);
    stream.start(async () => {});

    const failure = new Error("disk gone");
    storage.failNextCommit(failure);
    // The call that hit it gets the storage error itself.
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).rejects.toBe(failure);

    const failed = { name: "SessionFailed", cause: failure };
    await expect(task).rejects.toMatchObject(failed);
    await expect(idle).rejects.toMatchObject(failed);
    expect(await watch.closed).toEqual({ reason: "session_failed", error: failure });
    expect(await stream.closed).toEqual({ reason: "session_failed", error: failure });
    // Every later call, and a wait that starts now.
    await expect(harness.getTask(id, context)).rejects.toMatchObject(failed);
    await expect(harness.waitForIdle(context)).rejects.toMatchObject(failed);
    await expect(root.submit({ type: "input", content: "x" }, context)).rejects.toMatchObject(
      failed,
    );
    expect(await harness.closed).toEqual({ reason: "failed", error: failure });
    expect(signals).toEqual(["aborted"]);
    expect(reports).toEqual([failure]);
    await harness.close(context);
  });
});

describe("a failed Storage call", () => {
  it("fails it from a read off the Session line, as a context read makes", async () => {
    const storage = new FailingCalls();
    const { harness, root, reports } = await started(storage);
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    storage.failing.add("scanRange");
    await expect(root.context(context)).rejects.toBe(storage.error);
    expect(await harness.closed).toEqual({ reason: "failed", error: storage.error });
    expect(reports).toEqual([storage.error]);
    await harness.close(context);
  });

  it("ends Storage calls underway with SessionFailed, and closes once they have settled", async () => {
    const storage = new FailingCalls();
    const { harness, root } = await started(storage);
    const release = deferred();
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    storage.heldRange = { entered: deferred(), release: release.promise };
    const reading = root.context(context);
    await storage.heldRange.entered.promise;
    // Another call fails the Session while the context read is underway.
    storage.failing.add("mintId");
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).rejects.toBe(storage.error);
    let closed = false;
    void harness.closed.then(() => {
      closed = true;
    });
    for await (const _ of Array.from({ length: 5 }))
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    expect(closed).toBe(false);
    // The read succeeds at the backend, yet its caller gets the failure: nothing it read is used.
    release.resolve();
    await expect(reading).rejects.toMatchObject({ name: "SessionFailed", cause: storage.error });
    expect(await harness.closed).toEqual({ reason: "failed", error: storage.error });
    await harness.close(context);
  });
});

describe("a failed Storage call", () => {
  it("fails it when Storage cannot close; an earlier failure stays the cause", async () => {
    const closeError = new Error("close failed");
    class FailingClose extends ControlledStorage {
      override async close(closeContext: Context): Promise<void> {
        await super.close(closeContext);
        throw closeError;
      }
    }
    const healthy = await started(new FailingClose());
    await expect(healthy.harness.close(context)).rejects.toBe(closeError);
    expect(await healthy.harness.closed).toEqual({ reason: "failed", error: closeError });
    expect(healthy.reports).toEqual([closeError]);

    const storage = new FailingClose();
    const failed = await started(storage);
    const failure = new Error("disk gone");
    storage.failNextCommit(failure);
    await expect(
      failed.root.commit((tx) => tx.appendEntry(failed.root.id, { kind: "note" }), context),
    ).rejects.toBe(failure);
    expect(await failed.harness.closed).toEqual({ reason: "failed", error: failure });
    expect(failed.reports).toEqual([failure]);
  });

  it("rejects the Harness's own calls with SessionFailed after a failure", async () => {
    const storage = new ControlledStorage();
    const { harness, root } = await started(storage);
    const failure = new Error("disk gone");
    storage.failNextCommit(failure);
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).rejects.toBe(failure);
    const failed = { name: "SessionFailed", cause: failure };
    expect(() => harness.resume()).toThrow(expect.objectContaining(failed));
    await expect(harness.root(context)).rejects.toMatchObject(failed);
    await expect(harness.conversation(root.id, context)).rejects.toMatchObject(failed);
    await expect(
      harness.createConversation({ ownership: { kind: "ownerless" } }, context),
    ).rejects.toMatchObject(failed);
    await harness.close(context);
  });
});

describe("a failed Storage call", () => {
  it("ends what a task holds with session_failed, not as cancelled by its signal", async () => {
    const ends: unknown[] = [];
    const watching = deferred();
    const Watcher = defineTask<null, { phase: "work" }, null>({
      name: "test.watcher",
      version: 1,
      initial: () => ({ phase: "work" }),
      phases: {
        work: async (_task, runtime, phaseContext) => {
          const doc = (await runtime.watchDoc(LiveDoc, runtime.conversationId, phaseContext))!;
          const handle = (await runtime.conversation(runtime.conversationId, phaseContext))!;
          const idle = handle.waitForIdle(phaseContext).then(
            () => "resolved",
            (error: Error) => error.name,
          );
          watching.resolve();
          ends.push(await doc.closed, await idle);
        },
      },
      abort: async () => {},
    });
    const storage = new ControlledStorage();
    const opened = await openTasks(storage, [Watcher]);
    const root = await opened.harness.root(context);
    await root.commit(
      (tx) => tx.createTask(Watcher, null, { ownership: { kind: "conversation" } }),
      context,
    );
    opened.harness.resume();
    await watching.promise;
    const failure = new Error("disk gone");
    storage.failNextCommit(failure);
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).rejects.toBe(failure);
    await opened.harness.closed;
    expect(ends).toEqual([{ reason: "session_failed", error: failure }, "SessionFailed"]);
    await opened.harness.close(context);
  });
});

describe("a failed Storage call", () => {
  it("fails it from a failed ID mint", async () => {
    const storage = new FailingCalls();
    const { harness, root } = await started(storage);
    storage.failing.add("mintId");
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).rejects.toBe(storage.error);
    expect(await harness.closed).toEqual({ reason: "failed", error: storage.error });
    await harness.close(context);
  });

  it("does not commit what a callback did after it caught a failed read", async () => {
    const storage = new FailingCalls();
    const { harness, root } = await started(storage);
    const written = storage.admittedCommits.length;
    storage.failing.add("task");
    await expect(
      root.commit(async (tx) => {
        await tx.task(1 as TaskId).catch(() => {});
        await tx.appendEntry(root.id, { kind: "note" });
      }, context),
    ).rejects.toMatchObject({ name: "SessionFailed", cause: storage.error });
    expect(storage.admittedCommits.length).toBe(written);
    await harness.close(context);
  });

  it("fails it for a StorageRequestError from a commit, whose effect is unknown", async () => {
    const storage = new ControlledStorage();
    const { harness, root } = await started(storage);
    const rejection = new StorageRequestError("bad batch");
    storage.failNextCommit(rejection);
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).rejects.toBe(rejection);
    expect(await harness.closed).toEqual({ reason: "failed", error: rejection });
    await harness.close(context);
  });
});
