import {
  type AssistantMessage,
  type ToolResultMessage,
  type Usage,
  fauxAssistantMessage,
} from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { InboxDoc, type InboxState, LiveDoc, UsageDoc } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { recordUsage } from "../src/harness/usage.ts";
import harnessInboxSupport from "./harness-inbox-support.ts";
import support from "./support.ts";

const { HOLD, answer, gated, holdTool } = harnessInboxSupport;
const {
  addHooks,
  allEntries,
  awaited,
  chatSetup,
  context,
  deferred,
  documentChanges,
  openChat,
  waitFor,
} = support;

const storesInboxBase = Effect.gen(function* () {
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
        written.push({ empty, kind: content.kind });
      }
      return Promise.resolve(super.commit(writes, callContext));
    }
  }
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("second")]);
  const { harness, root } = yield* openChat(new RecordingStorage(), setup);
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication))
      if (change.record.kind === "msa.inbox") inboxId = change.record.id;
  });
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  yield* awaited(root.submit({ content: "f1", type: "input" }, context));
  const f2 = yield* awaited(root.submit({ content: "f2", type: "input" }, context));
  first.release();
  yield* awaited(input.wait(context));
  yield* awaited(f2.wait(context));
  expect(written).toEqual([
    { empty: false, kind: "delta" },
    { empty: false, kind: "delta" },
    { empty: true, kind: "base" },
  ]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("stores the inbox as a base exactly when it becomes empty", () =>
    Effect.runPromise(storesInboxBase));

  it("keeps a complete inbox base exactly while it is empty, and a usage base on every change", () => {
    const info = { deltasSinceBase: 1000 } as never;
    const item = { content: "x", id: 1 as never, mode: "followUp" } as const;
    expect(InboxDoc.definition.checkpointWhen!({ items: [] }, [], info)).toBe(true);
    expect(InboxDoc.definition.checkpointWhen!({ items: [item] }, [], info)).toBe(false);
    expect(UsageDoc.definition.checkpointWhen!({ models: {}, tools: {} }, [], info)).toBe(true);
  });
});

const retryingUsageChat = Effect.fn("retryingUsageChat")(function* () {
  const setup = chatSetup({ tokenSize: { max: 1, min: 1 }, tokensPerSecond: 200 });
  const spent: Usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 5,
    output: 0,
    totalTokens: 5,
  };
  const gate = deferred();
  gate.resolve();
  holdTool(setup, gate);
  addHooks(setup.registry, ToolTask, {
    afterTool: (_call, result) => ({ ...result, usage: spent }),
  });
  const retryable = fauxAssistantMessage([], {
    errorMessage: "503 Service Unavailable",
    stopReason: "error",
  });
  setup.faux.setResponses([retryable, HOLD, answer("done"), answer("x".repeat(400))]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  return { harness, root, setup, spent };
});

const totalsAssistantUsageStep1 = Effect.gen(function* () {
  const setup = chatSetup();
  const spent: Usage = {
    cacheRead: 3,
    cacheWrite: 4,
    cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
    input: 1,
    output: 2,
    totalTokens: 10,
  };
  const gate = deferred();
  gate.resolve();
  holdTool(setup, gate, { output: [], usage: spent });
  setup.faux.setResponses([HOLD, answer("done"), answer("other")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "a", type: "input" }, context))).wait(context),
  );
  const entries = yield* allEntries(root);
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
  const usage = (yield* awaited(harness.snapshot(UsageDoc, root.id, context)))!;
  expect(usage.models["faux/faux-1"]).toMatchObject(expected);
  expect(usage.tools).toEqual({ hold: spent });
  const result = entries.find((entry) => entry.kind === "msa.tool-result")!
    .model![0] as ToolResultMessage;
  expect(result.usage).toEqual(spent);

  const fork = yield* awaited(
    root.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context),
  );
  expect(yield* awaited(harness.snapshot(UsageDoc, fork.id, context))).toEqual({
    models: {},
    tools: {},
  });
  return { expected, fork, harness, spent };
});

const totalsAssistantUsage = Effect.gen(function* () {
  const { spent, harness, expected, fork } = yield* totalsAssistantUsageStep1;
  yield* awaited(
    (yield* awaited(fork.submit({ content: "b", type: "input" }, context))).wait(context),
  );
  const forkUsage = (yield* awaited(harness.snapshot(UsageDoc, fork.id, context)))!.models[
    "faux/faux-1"
  ]!;
  const total = yield* awaited(harness.usage(context));
  expect(total.models["faux/faux-1"]!.output).toBe(expected.output + forkUsage.output);
  expect(total.tools).toEqual({ hold: spent });
  yield* awaited(harness.close(context));
});

describe("usage", () => {
  it("totals assistant usage per model and tool usage per tool, and sums the Session", () =>
    Effect.runPromise(totalsAssistantUsage));
});

const countsFailedAttempts = Effect.gen(function* () {
  const { setup, spent, harness, root } = yield* retryingUsageChat();
  setup.settings.retry = { baseDelayMs: 1, enabled: true, maxRetries: 1 };
  yield* awaited(
    (yield* awaited(root.submit({ content: "a", type: "input" }, context))).wait(context),
  );
  expect((yield* awaited(harness.snapshot(UsageDoc, root.id, context)))!.tools).toEqual({
    hold: spent,
  });

  const input = yield* awaited(root.submit({ content: "b", type: "input" }, context));
  yield* waitFor(
    Effect.gen(function* () {
      return (
        (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))?.generation?.message !==
        undefined
      );
    }),
  );
  yield* awaited(
    harness.abortTask(
      (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId,
      context,
    ),
  );
  yield* awaited(input.wait(context));
  const assistants = (yield* allEntries(root)).flatMap((entry) =>
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
    (yield* awaited(harness.snapshot(UsageDoc, root.id, context)))!.models["faux/faux-1"]!.output,
  ).toBe(output);
  yield* awaited(harness.close(context));
});

describe("usage", () => {
  it("counts failed attempts, converted partials, and tool usage replaced by afterTool", () =>
    Effect.runPromise(countsFailedAttempts));
});

const keepsToolsNamed = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const usage: Usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 1,
    output: 1,
    totalTokens: 2,
  };
  const names = ["constructor", "__proto__", "toString"];
  for (const name of names) {
    yield* awaited(
      root.commit((tx) => runPromise(recordUsage(tx, root.id, "tools", name, usage)), context),
    );
    yield* awaited(
      root.commit((tx) => runPromise(recordUsage(tx, root.id, "tools", name, usage)), context),
    );
  }
  const total = yield* awaited(harness.usage(context));
  expect(Object.keys(total.tools)).toEqual(names);
  for (const name of names)
    expect(Object.getOwnPropertyDescriptor(total.tools, name)?.value.output).toBe(2);
  yield* awaited(harness.close(context));
});

describe("usage", () => {
  it("keeps tools named like object prototype keys in the ledger and the Session total", () =>
    Effect.runPromise(keepsToolsNamed));
});

const recordsUsageNumeric = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([answer("one"), answer("two")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const commits: { entries: number; ops: readonly Op[] }[] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind !== "msa.usage") continue;
      const entries = publication.changes.filter((other) => other.type === "entry").length;
      commits.push({ entries, ops: change.ops });
    }
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "a", type: "input" }, context))).wait(context),
  );
  yield* awaited(
    (yield* awaited(root.submit({ content: "b", type: "input" }, context))).wait(context),
  );
  expect(commits).toHaveLength(2);
  expect(commits[0]!.ops).toEqual([["s", ["models", "faux/faux-1"], expect.any(Object)]]);
  expect(commits[1]!.ops.every((op) => op[0] === "s" && op[1][1] === "faux/faux-1")).toBe(true);
  expect(commits.every((commit) => commit.entries >= 1)).toBe(true);
  yield* awaited(harness.close(context));
});

describe("usage", () => {
  it("records usage as numeric sets on the ledger in the entry's commit", () =>
    Effect.runPromise(recordsUsageNumeric));
});
