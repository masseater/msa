import { createModels } from "@msa/ai";
import type { Context } from "@msa/chord";
import {
  createRegistry,
  defineExtension,
  defineTask,
  Harness,
  LiveDoc,
  MemoryStorage,
} from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { conversationViews } from "../src/harness/view.ts";
import { started } from "./harness-storage-failure-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

async function stubbornRunHarness() {
  const release = deferred();
  const entered = deferred();
  const Stubborn = defineTask<null, { phase: "work" }, null>({
    name: "test.stubborn",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: async () => {
        entered.resolve();
        await release.promise;
      },
    },
    abort: async () => {},
  });
  const storage = new ControlledStorage();
  const registry = createRegistry();
  registry.install(defineExtension({ name: "tasks", tasks: [Stubborn] }));
  const reentry: { reentered?: Promise<unknown> } = {};
  const harness: Harness = await Harness.open(
    storage,
    {
      models: createModels(),
      registry,
      onReport: () => {
        reentry.reentered ??= harness.waitForIdle(context);
      },
    },
    context,
  );
  const root = await harness.root(context);
  return { release, entered, Stubborn, storage, reentry, harness, root };
}

describe("a failed Storage call", () => {
  it("fails only the call for an invalid request", async () => {
    const { harness, root, reports } = await started(new MemoryStorage());
    const entry = await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    const requests: (() => Promise<unknown>)[] = [
      () => root.entries({}, 10, { after: "x" }, context),
      async () => {
        const page = await root.entries({ order: "ascending" }, 1, undefined, context);
        return root.entries(
          { order: "descending" },
          1,
          page.next ?? { after: 1, order: "ascending" },
          context,
        );
      },
      () => root.commit((tx) => tx.scanEntries({ conversationId: 999_999 as never }, 10), context),
      // `msa.live` keeps no history.
      () => harness.snapshotAsOf(LiveDoc as never, root.id, entry.id, context),
    ];
    for await (const request of requests) {
      await expect(request()).rejects.toMatchObject({ name: "StorageRequestError" });
    }
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined();
    let ended = false;
    void harness.closed.then(() => {
      ended = true;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(ended).toBe(false);
    expect(reports).toEqual([]);
    await harness.close(context);
  });
});

describe("a failed Storage call", () => {
  it("fails it for a throw in its own commit listeners, which would leave memory behind storage", async () => {
    const storage = new ControlledStorage();
    const { harness, root, reports } = await started(storage);
    const bug = new Error("listener bug");
    (harness as unknown as { observeCommits(listener: () => void): void }).observeCommits(() => {
      throw bug;
    });
    // The commit itself is durable and resolves; the Session fails behind it.
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined();
    expect(await harness.closed).toEqual({ reason: "failed", error: bug });
    expect(reports).toEqual([bug]);
    await harness.close(context);
  });

  it("fails it for a storage error during a host close, before the backend closes", async () => {
    const storage = new ControlledStorage();
    const { harness, root, reports } = await started(storage);
    const held = storage.holdCommits();
    const failure = new Error("disk gone");
    storage.failNextCommit(failure);
    const committing = root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    await held.entered;
    const closing = harness.close(context);
    held.release();
    await expect(committing).rejects.toBe(failure);
    await closing;
    expect(await harness.closed).toEqual({ reason: "failed", error: failure });
    expect(reports).toEqual([failure]);
  });
});

describe("a failed Storage call", () => {
  it("ends an abort that joins a run ignoring its signal, and a reentrant report finds the Session failed", async () => {
    const { release, entered, Stubborn, storage, reentry, harness, root } =
      await stubbornRunHarness();
    const id = await root.commit(
      (tx) => tx.createTask(Stubborn, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await entered.promise;
    const held = storage.holdCommits();
    const aborting = harness.abortTask(id, context);
    await held.entered;
    held.release();
    // The abort mark commits and the abort joins the run, which ignores its signal; then the Session fails.
    const failure = new Error("disk gone");
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    storage.failNextCommit(failure);
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).rejects.toBe(failure);
    await expect(aborting).rejects.toMatchObject({ name: "SessionFailed", cause: failure });
    await expect(reentry.reentered).rejects.toMatchObject({
      name: "SessionFailed",
      cause: failure,
    });
    release.resolve();
    await harness.close(context);
  });
});

describe("a failed Storage call", () => {
  it("does not fail it for a read its caller cancelled", async () => {
    const controller = new AbortController();
    const cancelled = new Error("caller gave up");
    class CancelledRead extends MemoryStorage {
      override scanEntries(...args: Parameters<MemoryStorage["scanEntries"]>) {
        if (args[3].abortSignal === controller.signal) {
          controller.abort(cancelled);
          return Promise.reject(cancelled);
        }
        return Promise.resolve(super.scanEntries(...args));
      }
    }
    const { harness, root } = await started(new CancelledRead());
    const cancelling: Context = { ...context, abortSignal: controller.signal };
    await expect(root.context(cancelling)).rejects.toBe(cancelled);
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined();
    await harness.close(context);
  });
});

describe("listener and report errors", () => {
  it("reports a listener or onReport whose promise rejects, without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { harness, root, reports } = await started(new MemoryStorage());
      const asyncThrow = () => {
        return Promise.reject(new Error("async listener"));
      };
      harness.subscribeCommits(asyncThrow);
      harness.subscribeClose(asyncThrow);
      await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
      await harness.close(context);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(reports.map(String)).toEqual(["Error: async listener", "Error: async listener"]);

      const registry = createRegistry();
      const rejecting = await Harness.open(
        new MemoryStorage(),
        { models: createModels(), registry, onReport: asyncThrow },
        context,
      );
      rejecting.subscribeCommits(() => {
        throw new Error("sync listener");
      });
      const again = await rejecting.root(context);
      await again.commit((tx) => tx.appendEntry(again.id, { kind: "note" }), context);
      await rejecting.close(context);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("listener and report errors", () => {
  it("reports a throwing commit or close listener and runs the others; the commit stands", async () => {
    const storage = new MemoryStorage();
    const { harness, root, reports } = await started(storage);
    const seen: string[] = [];
    harness.subscribeCommits(() => {
      throw new Error("commit listener");
    });
    harness.subscribeCommits(() => seen.push("commit"));
    harness.subscribeClose(() => {
      throw new Error("close listener");
    });
    harness.subscribeClose(() => seen.push("close"));
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined();
    await harness.close(context);
    expect(seen).toEqual(["commit", "close"]);
    expect(reports.map(String)).toEqual(["Error: commit listener", "Error: close listener"]);
  });
});

describe("listener and report errors", () => {
  it("keeps feeding the other observers of a view when one throws", async () => {
    const { harness, root, reports } = await started(new MemoryStorage());
    const views = conversationViews(harness);
    const failure = new Error("observer broke");
    await views.attach(
      root.id,
      () =>
        Promise.resolve({
          publication: () => {
            throw failure;
          },
          closeSession: () => {},
        }),
      context,
    );
    const watch = await root.watch(context);
    const seen: unknown[] = [];
    watch.start((value) => {
      seen.push(value);

      return Promise.resolve();
    });
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    const delivered = async (): Promise<void> => {
      if (seen.length > 0) return;
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      await delivered();
    };
    await delivered();
    expect(reports).toEqual([failure]);
    await harness.close(context);
    expect(await watch.closed).toEqual({ reason: "session_closed" });
  });
});
