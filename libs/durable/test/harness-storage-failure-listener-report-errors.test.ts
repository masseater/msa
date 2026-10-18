import { runInNewContext } from "node:vm";

import { createModels } from "@msa/ai";
import { defineExtension, defineTask, LiveDoc } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { safeNow } from "../src/harness/harness.ts";
import { contained } from "../src/session/session.ts";
import { running, Waiting, started } from "./harness-storage-failure-support.ts";
import { context } from "./session-support.ts";
import { openTasks } from "./task-support.ts";

describe("listener and report errors", () => {
  it("contains a fulfilled thenable that calls only its fulfillment handler", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("uncaughtException", onUnhandled);
    process.on("unhandledRejection", onUnhandled);
    try {
      const errors: unknown[] = [];
      // A thenable that, like some libraries' promises, calls only the handler it settles with.
      // biome-ignore lint/suspicious/noThenProperty: the test is about a thenable
      const thenable = { then: (resolve: () => void) => queueMicrotask(() => resolve()) };
      contained(
        () => thenable,
        (error) => errors.push(error),
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(errors).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("uncaughtException", onUnhandled);
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("contains a rejected promise from another realm", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const foreign = runInNewContext("Promise.reject(new Error('foreign'))") as Promise<never>;
      const errors: unknown[] = [];
      contained(
        () => foreign,
        (error) => errors.push(error),
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(errors.map(String)).toEqual(["Error: foreign"]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("listener and report errors", () => {
  it("reports a throwing watch listener, which ends that watch", async () => {
    const { harness, root, reports } = await started(new MemoryStorage());
    const watch = (await harness.watchDoc(LiveDoc, root.id, context))!;
    const failure = new Error("listener broke");
    watch.start(() => {
      return Promise.reject(failure);
    });
    await root.commit(async (tx) => {
      (await tx.doc(LiveDoc, root.id)).compactions = [];
    }, context);
    expect(await watch.closed).toEqual({ reason: "listener_error", error: failure });
    expect(reports).toEqual([failure]);
    await harness.close(context);
  });
});

describe("listener and report errors", () => {
  it("faults only the task, and ends only the watch, for a thrown value that cannot be formatted", async () => {
    const unformattable = Object.create(null) as object;
    const Throws = defineTask<null, { phase: "work" }, null>({
      name: "test.throws-unformattable",
      version: 1,
      initial: () => ({ phase: "work" }),
      phases: {
        work: () => {
          return Promise.reject(unformattable);
        },
      },
      abort: async () => {},
    });
    const opened = await openTasks(new MemoryStorage(), [Throws]);
    const root = await opened.harness.root(context);
    const watch = (await opened.harness.watchDoc(LiveDoc, root.id, context))!;
    watch.start(() => {
      return Promise.reject(unformattable);
    });
    const id = await root.commit(
      (tx) => tx.createTask(Throws, null, { ownership: { kind: "conversation" } }),
      context,
    );
    opened.harness.resume();
    expect((await opened.harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "faulted",
      error: { message: "[object Object]" },
    });
    await root.commit(async (tx) => {
      (await tx.doc(LiveDoc, root.id)).compactions = [];
    }, context);
    expect(await watch.closed).toMatchObject({ reason: "listener_error" });
    await expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined();
    await opened.harness.close(context);
  });
});

describe("listener and report errors", () => {
  it("reports a throwing clock once, also when the report handler reads the clock again", () => {
    const reports: unknown[] = [];
    const clock = safeNow(
      () => {
        throw new Error("clock broke");
      },
      (error) => {
        reports.push(error);
        // Reentry, as a handler that commits does: the clock is read again before this report returns.
        if (reports.length < 5) clock();
      },
    );
    expect(clock()).toEqual(expect.any(Number));
    clock();
    expect(reports.map(String)).toEqual(["Error: clock broke"]);
  });

  it("keeps working when onReport throws, and falls back to Date.now when the clock throws", async () => {
    const registry = createRegistry();
    registry.install(defineExtension({ name: "tasks", tasks: [Waiting] }));
    const harness = await Harness.open(
      new MemoryStorage(),
      {
        models: createModels(),
        registry,
        now: () => {
          throw new Error("clock broke");
        },
        onReport: () => {
          throw new Error("report broke");
        },
      },
      context,
    );
    const root = await harness.root(context);
    const id = await root.commit(
      (tx) => tx.createTask(Waiting, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await running(harness, id);
    expect((await harness.getTask(id, context))?.startedAt).toEqual(expect.any(Number));
    await harness.abortTask(id, context);
    expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("aborted");
    await harness.close(context);
  });
});
