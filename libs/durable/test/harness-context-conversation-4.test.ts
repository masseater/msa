import { createModels, type Message } from "@msa/ai";
import {
  createRegistry,
  defineTask,
  type EntryRecord,
  Harness,
  MemoryStorage,
  type Storage,
} from "@msa/durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { countingSetup, runInRoot, ABORTED, DONE, probeTask } from "./harness-context-support.ts";
import { addTask, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("conversation context", () => {
  it("keeps returned views and kept ranges apart", async () => {
    const opened = await countingSetup();
    await runInRoot(opened, "test.context-mutate", async (runtime, taskContext) => {
      const view = await runtime.context(opened.root.id, taskContext);
      (view.messages as Message[]).length = 0;
      (view.entries as EntryRecord[]).pop();
      // Kept entries are frozen like MemoryStorage records.
      expect(() => {
        (view.contributions[0]![0] as { content: unknown }).content = "changed";
      }).toThrow(TypeError);
      expect(await runtime.context(opened.root.id, taskContext)).toEqual(
        await opened.root.context(taskContext),
      );
    });
    await opened.harness.close(context);
  });
});

describe("conversation context", () => {
  it("freezes kept entries deeply even when storage freezes them shallowly", async () => {
    const memory = new MemoryStorage();
    // Fresh copies with only the record itself frozen; their messages stay mutable.
    const storage = new Proxy<Storage>(memory, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (key === "scanEntries") {
          return async (...args: Parameters<Storage["scanEntries"]>) => {
            const page = await target.scanEntries(...args);
            return {
              ...page,
              items: page.items.map((item) => Object.freeze(structuredClone(item))),
            };
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const registry = createRegistry();
    const harness = await Harness.open(storage, { models: createModels(), registry }, context);
    const root = await harness.root(context);
    await root.commit(
      (tx) => tx.appendEntry(root.id, { kind: "message", model: [user("hello")] }),
      context,
    );
    await runInRoot({ harness, registry, root }, "test.context-shallow", async (runtime, ctx) => {
      const view = await runtime.context(root.id, ctx);
      expect(() => {
        (view.messages[0] as { content: unknown }).content = "changed";
      }).toThrow(TypeError);
    });
    await harness.close(context);
  });
});

describe("conversation context", () => {
  it("does not keep a read that finishes after its task ended", async () => {
    const { harness, registry, root, scanned, hold } = await countingSetup({
      settings: { contextRetentionMs: 0 },
    });
    const scans = Promise.withResolvers<void>();
    const probeStart = Promise.withResolvers<void>();
    let late: Promise<unknown> | undefined;
    const Late = defineTask<Record<string, never>, { phase: "run" }, null>({
      name: "test.context-late",
      version: 1,
      initial: () => ({ phase: "run" }),
      phases: {
        run: async (_task, runtime, taskContext) => {
          hold.scan = scans.promise;
          late = runtime.context(root.id, taskContext).catch((error: unknown) => error);
          await runtime.commit(() => DONE, taskContext);
        },
      },
      abort: async (_task, runtime, taskContext) => {
        await runtime.commit(() => ABORTED, taskContext);
      },
    });
    const rows: Record<string, number> = {};
    const Probe = probeTask(async (name, load) => {
      await probeStart.promise;
      const before = scanned.rows;
      await load();
      rows[name] = scanned.rows - before;
    });
    for (const task of [Late, Probe]) addTask(registry, task);
    harness.resume();
    const options = { ownership: { kind: "conversation" }, conversationId: root.id } as const;
    const lateId = await harness.commit((tx) => tx.createTask(Late, {}, options), context);
    expect((await harness.waitForTask(lateId, context)).state.outcome).toEqual(DONE.outcome);
    // The conversation is busy again when the late read finishes; its range must not be kept.
    const probeId = await harness.commit(
      (tx) => tx.createTask(Probe, { name: "probe" }, options),
      context,
    );
    scans.resolve();
    await late;
    probeStart.resolve();
    expect((await harness.waitForTask(probeId, context)).state.outcome).toEqual(DONE.outcome);
    expect(rows).toEqual({ probe: 22 });
    await harness.close(context);
  });
});

describe("conversation context", () => {
  it("drops an idle conversation's context read on a timer when nothing else runs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { harness, registry, root, scanned } = await countingSetup({
      settings: { contextRetentionMs: 1_000 },
    });
    const rows: Record<string, number> = {};
    const Probe = probeTask(async (name, load) => {
      const before = scanned.rows;
      await load();
      rows[name] = scanned.rows - before;
    });
    addTask(registry, Probe);
    harness.resume();
    const options = { ownership: { kind: "conversation" }, conversationId: root.id } as const;
    const probe = async (name: string) => {
      const id = await harness.commit((tx) => tx.createTask(Probe, { name }, options), context);
      expect((await harness.waitForTask(id, context)).state.outcome).toEqual(DONE.outcome);
      await root.waitForIdle(context);
    };
    const idle = vi.getTimerCount();
    await probe("first");
    expect(vi.getTimerCount()).toBe(idle + 1);
    vi.advanceTimersByTime(1_000);
    expect(vi.getTimerCount()).toBe(idle);
    await probe("second");
    expect(rows).toEqual({ first: 22, second: 22 });
    await harness.close(context);
  });
});

describe("conversation context", () => {
  it("drops a conversation's context read once idle with zero retention", async () => {
    const { harness, registry, root, scanned } = await countingSetup({
      settings: { contextRetentionMs: 0 },
    });
    const rows: Record<string, number> = {};
    const Probe = probeTask(async (name, load) => {
      const before = scanned.rows;
      await load();
      rows[name] = scanned.rows - before;
    });
    addTask(registry, Probe);
    harness.resume();
    const options = { ownership: { kind: "conversation" }, conversationId: root.id } as const;
    for await (const name of ["first", "second"]) {
      const id = await harness.commit((tx) => tx.createTask(Probe, { name }, options), context);
      expect((await harness.waitForTask(id, context)).state.outcome).toEqual(DONE.outcome);
      await root.waitForIdle(context);
    }
    expect(rows).toEqual({ first: 22, second: 22 });
    await harness.close(context);
  });
});
