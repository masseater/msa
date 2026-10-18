import {
  type AssistantMessage,
  fauxAssistantMessage,
  type ToolResultMessage,
  type Usage,
} from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { InboxDoc, type InboxState, LiveDoc, UsageDoc } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { recordUsage } from "../src/harness/usage.ts";
import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
import { HOLD, holdTool, answer, gated } from "./harness-inbox-support.ts";
import { addHooks } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";
import { deferred } from "./task-support.ts";

describe("inbox", () => {
  it("stores the inbox as a base exactly when it becomes empty", async () => {
    const written: { kind: "base" | "delta"; empty: boolean }[] = [];
    let inboxId: number | undefined;
    class RecordingStorage extends MemoryStorage {
      override commit(
        writes: Parameters<MemoryStorage["commit"]>[0],
        callContext: Parameters<MemoryStorage["commit"]>[1],
      ) {
        for (const write of writes) {
          if (write.type !== "document.change" || write.id !== inboxId) continue;
          const content = write.content;
          const empty = content.kind === "base" && (content.value as InboxState).items.length === 0;
          written.push({ kind: content.kind, empty });
        }
        return Promise.resolve(super.commit(writes, callContext));
      }
    }
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("second")]);
    const { harness, root } = await openChat(new RecordingStorage(), setup);
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication))
        if (change.record.kind === "msa.inbox") inboxId = change.record.id;
    });
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    await root.submit({ type: "input", content: "f1" }, context);
    const f2 = await root.submit({ type: "input", content: "f2" }, context);
    first.release();
    await input.wait(context);
    await f2.wait(context);
    // The inbox ID is learned from the f1 push; later writes: the f2 push, removing f1, and emptying the inbox.
    expect(written).toEqual([
      { kind: "delta", empty: false },
      { kind: "delta", empty: false },
      { kind: "base", empty: true },
    ]);
    await harness.close(context);
  });

  it("keeps a complete inbox base exactly while it is empty, and a usage base on every change", () => {
    const info = { deltasSinceBase: 1000 } as never;
    const item = { id: 1 as never, mode: "followUp", content: "x" } as const;
    expect(InboxDoc.definition.checkpointWhen!({ items: [] }, [], info)).toBe(true);
    expect(InboxDoc.definition.checkpointWhen!({ items: [item] }, [], info)).toBe(false);
    expect(UsageDoc.definition.checkpointWhen!({ models: {}, tools: {} }, [], info)).toBe(true);
  });
});

async function retryingUsageChat() {
  const setup = chatSetup({ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } });
  const spent: Usage = {
    input: 5,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 5,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const gate = deferred();
  gate.resolve();
  holdTool(setup, gate);
  addHooks(setup.registry, ToolTask, {
    afterTool: (_call, result) => ({ ...result, usage: spent }),
  });
  const retryable = fauxAssistantMessage([], {
    stopReason: "error",
    errorMessage: "503 Service Unavailable",
  });
  setup.faux.setResponses([retryable, HOLD, answer("done"), answer("x".repeat(400))]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  return { setup, spent, harness, root };
}

describe("usage", () => {
  it("totals assistant usage per model and tool usage per tool, and sums the Session", async () => {
    const setup = chatSetup();
    const spent: Usage = {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
    };
    const gate = deferred();
    gate.resolve();
    holdTool(setup, gate, { output: [], usage: spent });
    setup.faux.setResponses([HOLD, answer("done"), answer("other")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await (await root.submit({ type: "input", content: "a" }, context)).wait(context);
    const entries = await allEntries(root);
    const assistants = entries.flatMap((entry) =>
      entry.kind === "msa.assistant" ? [entry.model![0] as AssistantMessage] : [],
    );
    const expected = assistants.reduce(
      (sum, message) => ({
        input: sum.input + message.usage.input,
        output: sum.output + message.usage.output,
        totalTokens: sum.totalTokens + message.usage.totalTokens,
      }),
      { input: 0, output: 0, totalTokens: 0 },
    );
    const usage = (await harness.snapshot(UsageDoc, root.id, context))!;
    expect(usage.models["faux/faux-1"]).toMatchObject(expected);
    expect(usage.tools).toEqual({ hold: spent });
    const result = entries.find((entry) => entry.kind === "msa.tool-result")!
      .model![0] as ToolResultMessage;
    expect(result.usage).toEqual(spent);

    // A fork starts at zero; the Session total adds every conversation once.
    const fork = await root.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context);
    expect(await harness.snapshot(UsageDoc, fork.id, context)).toEqual({ models: {}, tools: {} });
    await (await fork.submit({ type: "input", content: "b" }, context)).wait(context);
    const forkUsage = (await harness.snapshot(UsageDoc, fork.id, context))!.models["faux/faux-1"]!;
    const total = await harness.usage(context);
    expect(total.models["faux/faux-1"]!.output).toBe(expected.output + forkUsage.output);
    expect(total.tools).toEqual({ hold: spent });
    await harness.close(context);
  });
});

describe("usage", () => {
  it("counts failed attempts, converted partials, and tool usage replaced by afterTool", async () => {
    const { setup, spent, harness, root } = await retryingUsageChat();
    setup.settings.retry = { enabled: true, maxRetries: 1, baseDelayMs: 1 };
    await (await root.submit({ type: "input", content: "a" }, context)).wait(context);
    expect((await harness.snapshot(UsageDoc, root.id, context))!.tools).toEqual({ hold: spent });

    // A partial committed while streaming becomes an aborted entry on abort; its usage counts too.
    const input = await root.submit({ type: "input", content: "b" }, context);
    await waitFor(
      async () =>
        (await harness.snapshot(LiveDoc, root.id, context))?.generation?.message !== undefined,
    );
    await harness.abortTask(
      (await harness.snapshot(LiveDoc, root.id, context))!.run!.taskId,
      context,
    );
    await input.wait(context);
    const assistants = (await allEntries(root)).flatMap((entry) =>
      entry.kind === "msa.assistant" ? [entry.model![0] as AssistantMessage] : [],
    );
    expect(assistants.map((message) => message.stopReason)).toEqual([
      "error",
      "toolUse",
      "stop",
      "aborted",
    ]);
    const output = assistants.reduce((sum, message) => sum + message.usage.output, 0);
    expect(
      (await harness.snapshot(UsageDoc, root.id, context))!.models["faux/faux-1"]!.output,
    ).toBe(output);
    await harness.close(context);
  });
});

describe("usage", () => {
  it("keeps tools named like object prototype keys in the ledger and the Session total", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const usage: Usage = {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const names = ["constructor", "__proto__", "toString"];
    for await (const name of names) {
      await root.commit(
        (tx) => Effect.runPromise(recordUsage(tx, root.id, "tools", name, usage)),
        context,
      );
      await root.commit(
        (tx) => Effect.runPromise(recordUsage(tx, root.id, "tools", name, usage)),
        context,
      );
    }
    const total = await harness.usage(context);
    expect(Object.keys(total.tools)).toEqual(names);
    for (const name of names)
      expect(Object.getOwnPropertyDescriptor(total.tools, name)?.value.output).toBe(2);
    await harness.close(context);
  });
});

describe("usage", () => {
  it("records usage as numeric sets on the ledger in the entry's commit", async () => {
    const setup = chatSetup();
    setup.faux.setResponses([answer("one"), answer("two")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const commits: { entries: number; ops: readonly Op[] }[] = [];
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication)) {
        if (change.record.kind !== "msa.usage") continue;
        const entries = publication.changes.filter((other) => other.type === "entry").length;
        commits.push({ entries, ops: change.ops });
      }
    });
    await (await root.submit({ type: "input", content: "a" }, context)).wait(context);
    await (await root.submit({ type: "input", content: "b" }, context)).wait(context);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.ops).toEqual([["s", ["models", "faux/faux-1"], expect.any(Object)]]);
    expect(commits[1]!.ops.every((op) => op[0] === "s" && op[1][1] === "faux/faux-1")).toBe(true);
    expect(commits.every((commit) => commit.entries >= 1)).toBe(true);
    await harness.close(context);
  });
});
