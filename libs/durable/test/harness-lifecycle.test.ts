import { createModels, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";
import { type ConversationId, defineTool, type Storage, type TaskId } from "@msa/durable";
import { createRegistry, GenerationTask, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { start, oneStep, storageOpen, withSignal } from "./harness-lifecycle-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { countingReader, deferred, openTasks, settled } from "./task-support.ts";

// Commit a conversation with a `running` task, as a crash leaves it, so open has a reconciliation commit to fail.
async function seedRunningTask(storage: Storage): Promise<void> {
  const conversationId = await storage.mintId<ConversationId>();
  const id = await storage.mintId<TaskId<JsonValue>>();
  const state = { status: "running", checkpoint: { phase: "run" } } as const;
  const task = {
    id,
    conversationId,
    kind: "test.seeded",
    version: 1,
    input: null,
    background: false,
    state,
  };
  await storage.commit(
    [
      { type: "conversation", value: { id: conversationId } },
      { type: "task", value: { ...task, abortRequested: false } },
    ],
    context,
  );
}

describe("Harness open", () => {
  it("closes without a cancelled caller context and rethrows the original error when open fails", async () => {
    const storage = new ControlledStorage();
    await seedRunningTask(storage);
    const reader = countingReader(createRegistry());
    const held = storage.holdCommits();
    storage.failNextCommit(new Error("disk full"));
    const controller = new AbortController();
    const opening = Harness.open(
      storage,
      { models: createModels(), registry: reader },
      withSignal(controller.signal),
    );
    await held.entered;
    controller.abort(new Error("caller gave up"));
    held.release();
    await expect(opening).rejects.toThrow("disk full");
    expect(reader.subscriptions()).toBe(0);
    expect(await storageOpen(storage)).toBe(false);
  });

  it("rethrows the open error and reports it once, though closing then fails too", async () => {
    class FailingClose extends ControlledStorage {
      override async close(closeContext: Context): Promise<void> {
        await super.close(closeContext);
        throw new Error("close failed");
      }
    }
    const storage = new FailingClose();
    await seedRunningTask(storage);
    storage.failNextCommit(new Error("disk full"));
    const reports: unknown[] = [];
    const opening = Harness.open(
      storage,
      {
        models: createModels(),
        registry: createRegistry(),
        onReport: (error) => reports.push(error),
      },
      context,
    );
    await expect(opening).rejects.toThrow("disk full");
    // The storage failure that failed open is the cause; the close that fails after it adds no report.
    expect(reports).toEqual([new Error("disk full")]);
  });
});

describe("Harness close", () => {
  it("joins a task handler that ignores its signal before closing Storage", async () => {
    const storage = new MemoryStorage();
    const reached = deferred();
    const gate = deferred();
    let readAfterRelease: boolean | undefined;
    const Stubborn = oneStep("test.close-stubborn", async () => {
      reached.resolve();
      await gate.promise;
      readAfterRelease = await storageOpen(storage);
    });
    const { harness } = await openTasks(storage, [Stubborn]);
    await start(await harness.root(context), Stubborn);
    harness.resume();
    await reached.promise;
    const closing = harness.close(context);
    expect(await settled(closing)).toBe(false);
    expect(await storageOpen(storage)).toBe(true);
    gate.resolve();
    await closing;
    expect(readAfterRelease).toBe(true);
    expect(await storageOpen(storage)).toBe(false);
  });
});

describe("Harness close", () => {
  it("joins a tool execute and a hook that ignore their signal before closing Storage", async () => {
    for await (const where of ["tool", "hook"] as const) {
      const setup = chatSetup();
      const storage = new MemoryStorage();
      const reached = deferred();
      const gate = deferred();
      let readAfterRelease: boolean | undefined;
      const stubborn = async (): Promise<void> => {
        reached.resolve();
        await gate.promise;
        readAfterRelease = await storageOpen(storage);
      };
      addTool(
        setup.registry,
        defineTool({
          name: "wait",
          description: "wait",
          parameters: Type.Object({}),
          execute: async () => {
            if (where === "tool") await stubborn();
            return { output: [] };
          },
        }),
      );
      addHooks(setup.registry, GenerationTask, {
        beforeRequest: async () => {
          if (where === "hook") await stubborn();
          return undefined;
        },
      });
      setup.faux.setResponses([
        fauxAssistantMessage([fauxToolCall("wait", {}, { id: "c1" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("done")]),
      ]);
      const { harness, root } = await openChat(storage, setup);
      await root.submit({ type: "input", content: "go" }, context);
      await reached.promise;
      const closing = harness.close(context);
      expect(await settled(closing)).toBe(false);
      expect(await storageOpen(storage)).toBe(true);
      gate.resolve();
      await closing;
      expect(readAfterRelease).toBe(true);
      expect(await storageOpen(storage)).toBe(false);
    }
  });
});

describe("Harness close", () => {
  it("keeps shutting down after a cancelled close, and a second close awaits the same shutdown", async () => {
    const storage = new MemoryStorage();
    const reached = deferred();
    const gate = deferred();
    const Stubborn = oneStep("test.close-cancelled", async () => {
      reached.resolve();
      await gate.promise;
    });
    const { harness } = await openTasks(storage, [Stubborn]);
    await start(await harness.root(context), Stubborn);
    harness.resume();
    await reached.promise;
    const controller = new AbortController();
    const cancelled = harness.close(withSignal(controller.signal));
    controller.abort(new Error("stop waiting"));
    await expect(cancelled).rejects.toThrow("stop waiting");
    // Admission stays sealed and the invocation still holds Storage open.
    await expect(harness.commit(() => {}, context)).rejects.toThrow("closed");
    expect(await storageOpen(storage)).toBe(true);
    const second = harness.close(context);
    expect(await settled(second)).toBe(false);
    gate.resolve();
    await second;
    expect(await storageOpen(storage)).toBe(false);
  });

  it("settles durably a commit whose committer was cancelled while it was in Storage", async () => {
    const storage = new ControlledStorage();
    const { harness } = await openTasks(storage, []);
    const root = await harness.root(context);
    const held = storage.holdCommits();
    const controller = new AbortController();
    const committing = root.commit(
      (tx) => tx.appendEntry(root.id, { kind: "note" }).then((entry) => entry.id),
      withSignal(controller.signal),
    );
    await held.entered;
    controller.abort(new Error("committer gave up"));
    held.release();
    const id = await committing;
    const page = await root.entries({}, 10, undefined, context);
    expect(page.items.map((entry) => entry.id)).toEqual([id]);
    await harness.close(context);
  });
});
