import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxToolCall, Type } from "@msa/ai";
import {
  type AgentEvent,
  type CompactionResult,
  defineTool,
  ProviderDoc,
  type TaskId,
} from "@msa/durable";
import { CompactionTask, watchEvents } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { toolsNamed, waitFor } from "./chat-support.ts";
import {
  compactionTasks,
  text,
  summary,
  answer,
  gated,
  history,
  turn,
  directories,
  MANUAL,
  BACKGROUND,
  compactionInput,
  live,
  failure,
  firstUserText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("compaction outcomes", () => {
  it("completes without a summary when a hook declines", async () => {
    const chat = await open();
    addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) });
    await history(chat);
    expect(await result(chat, await chat.root.compact(undefined, context))).toEqual({
      status: "completed",
      result: {},
    });
    expect(chat.faux.summaryRequests).toHaveLength(0);
    await chat.harness.close(context);
  });

  it("fails with no_model without a configured model", async () => {
    const chat = await open();
    await history(chat);
    await chat.root.configure({ model: null }, context);
    const outcome = await result(chat, await chat.root.compact(undefined, context));
    expect(outcome).toMatchObject({ status: "failed", error: { detail: { reason: "no_model" } } });
    expect((await live(chat)).compactions).toBeUndefined();
    await chat.harness.close(context);
  });
});

describe("compaction outcomes", () => {
  it("retries a retryable error with the pinned request and counts every attempt once", async () => {
    const single = await open();
    await history(single);
    await single.root.configure({ thinkingLevel: "high" }, context);
    single.faux.summaries.push(summary());
    const once = await compactionInput(single, async () =>
      result(single, await single.root.compact(undefined, context)),
    );
    expect(once).toBeGreaterThan(0);
    await single.harness.close(context);

    const chat = await open();
    await history(chat);
    await chat.root.configure({ thinkingLevel: "high" }, context);
    chat.setup.settings.stream = { timeoutMs: 1234, deferred: true };
    chat.faux.summaries.push(async () => {
      // Changed during the attempt: the retry still uses the pinned request.
      await chat.root.configure({ thinkingLevel: "low" }, context);
      chat.setup.settings.stream = { timeoutMs: 1 };
      return failure("overloaded");
    });
    chat.faux.summaries.push(summary());
    const twice = await compactionInput(chat, async () => {
      expect((await result(chat, await chat.root.compact(undefined, context))).status).toBe(
        "completed",
      );
    });
    expect(chat.faux.summaryRequests).toHaveLength(2);
    expect(twice).toBe(2 * once);
    const sessionId = (await chat.harness.snapshot(ProviderDoc, chat.root.id, context))!.sessionId;
    for (const request of chat.faux.summaryRequests) {
      expect(request.options).toMatchObject({
        reasoning: "high",
        timeoutMs: 1234,
        cacheRetention: "none",
        sessionId,
      });
      expect(request.options?.deferred).toBeUndefined();
    }
    await chat.harness.close(context);
  });
});

describe("compaction outcomes", () => {
  it("adds no usage when a hook declines or supplies the summary", async () => {
    for await (const decision of [{ decline: true } as const, { summary: "HOOK" }]) {
      const chat = await open();
      addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => decision });
      await history(chat);
      expect(
        await compactionInput(chat, async () =>
          result(chat, await chat.root.compact(undefined, context)),
        ),
      ).toBe(0);
      await chat.harness.close(context);
    }
  });

  it("caps maxTokens at the model's output limit and sends no tools", async () => {
    const chat = await open();
    addTool(
      chat.setup.registry,
      defineTool({
        name: "read",
        description: "read",
        parameters: Type.Object({}),
        execute: () => Promise.resolve({ output: [] }),
      }),
    );
    await chat.root.configure({ tools: toolsNamed(chat.setup, "read") }, context);
    await history(chat);
    chat.setup.settings.compaction = { ...MANUAL, reserveTokens: 2000 };
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    const request = chat.faux.summaryRequests[0]!;
    // 0.8 * 2000 = 1600, above the model's 900.
    expect(request.options?.maxTokens).toBe(900);
    expect(request.messages).toHaveLength(2);
    expect(
      request.messages.some(
        (message) => message.role === "system" && message.toolsAdded !== undefined,
      ),
    ).toBe(false);
    await chat.harness.close(context);
  });
});

describe("compaction outcomes", () => {
  for (const [name, response, message] of [
    ["retries run out", failure("overloaded"), "Summarization failed: overloaded"],
    ["a non-retryable error", failure("bad request"), "Summarization failed: bad request"],
    [
      "a length stop",
      fauxAssistantMessage("partial", { stopReason: "length" }),
      "Summarization hit the token limit; the summary is incomplete",
    ],
    [
      "a tool call",
      fauxAssistantMessage([fauxToolCall("read", {})], { stopReason: "stop" }),
      "Summarization attempted to call a tool",
    ],
    ["empty text", answer("  "), "Summarization produced no text"],
  ] as const) {
    it(`fails with model_error on ${name}`, async () => {
      const chat = await open();
      await history(chat);
      for (let index = 0; index < 3; index++) chat.faux.summaries.push(response);
      const outcome = await result(chat, await chat.root.compact(undefined, context));
      expect(outcome).toMatchObject({
        status: "failed",
        error: { message, detail: { reason: "model_error" } },
      });
      // The retry policy allows two retries after the first attempt.
      expect(chat.faux.summaryRequests).toHaveLength(name === "retries run out" ? 3 : 1);
      expect((await live(chat)).compactions).toBeUndefined();
      expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
      await chat.harness.close(context);
    });
  }
});

describe("background threshold compaction", () => {
  it("starts above the background threshold without blocking the run; idle waits and Esc ignore it", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    chat.setup.settings.compaction = BACKGROUND;
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary(), reached));
    await turn(chat, text("u4", 100), text("a4", 100));
    await reached.promise;
    const [task] = await compactionTasks(chat);
    expect(task).toMatchObject({ background: true, input: { reason: "threshold" } });
    expect(task!.owner).toBeUndefined();
    expect((await live(chat)).compactions).toEqual([
      { taskId: task!.id, reason: "threshold", blocking: false, attempt: 1 },
    ]);
    // Background work: neither conversation idle nor Esc waits for or stops it.
    await chat.root.waitForIdle(context);
    await chat.root.abort(context);
    expect((await chat.harness.getTask(task!.id, context))?.state.status).toBe("running");
    gate.resolve();
    const outcome = await result(chat, task!.id as TaskId<CompactionResult>);
    expect(outcome.status).toBe("completed");
    expect((await kinds(chat.root)).at(-1)).toBe("msa.compaction");
    expect(firstUserText((await chat.root.context(context)).messages)).toContain("SUMMARY");
    await chat.harness.close(context);
  });

  for (const [name, policy] of [
    ["disabled", { ...BACKGROUND, enabled: false }],
    ["backgroundTokens is 0", { ...BACKGROUND, backgroundTokens: 0 }],
    ["there is no cut", { ...BACKGROUND, keepRecentTokens: 100_000 }],
  ] as const) {
    it(`does not start when ${name}`, async () => {
      const chat = await open({ contextWindow: 2000 });
      await history(chat);
      chat.setup.settings.compaction = policy;
      await turn(chat, text("u4", 100), text("a4", 100));
      expect(await compactionTasks(chat)).toEqual([]);
      expect(chat.faux.summaryRequests).toHaveLength(0);
      await chat.harness.close(context);
    });
  }
});

describe("background threshold compaction", () => {
  it("does not start while another compaction is listed", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    const manual = await chat.root.compact(undefined, context);
    await reached.promise;
    chat.setup.settings.compaction = BACKGROUND;
    await turn(chat, text("u4", 100), text("a4", 100));
    expect((await compactionTasks(chat)).map((task) => task.id)).toEqual([manual]);
    await chat.harness.abortTask(manual, context);
    await chat.harness.close(context);
  });
});

describe("background threshold compaction", () => {
  it("records a failure in msa.live, the snapshot, and compaction_end until a summary is produced", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    chat.setup.settings.compaction = BACKGROUND;
    const events: AgentEvent[] = [];
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    stream.start((batch) => {
      events.push(...batch);

      return Promise.resolve();
    });
    chat.faux.summaries.push(failure("bad request"));
    await turn(chat, text("u4", 100), text("a4", 100));
    await waitFor(() => events.some((event) => event.type === "compaction_end"));
    const recorded = (await live(chat)).compactionFailure;
    expect(recorded).toMatchObject({
      reason: "threshold",
      error: "Summarization failed: bad request",
    });
    expect(events.find((event) => event.type === "compaction_end")).toEqual({
      type: "compaction_end",
      taskId: recorded!.taskId,
      reason: "threshold",
      error: "Summarization failed: bad request",
    });
    const reopened = await watchEvents(chat.harness, chat.root.id, context);
    expect(reopened.snapshot.compactionFailure).toEqual(recorded);
    await reopened.stop();
    // A compaction that produces a summary removes the failure, and ends without an error.
    chat.setup.settings.compaction = MANUAL;
    chat.faux.summaries.push(summary());
    const manual = await chat.root.compact(undefined, context);
    expect((await result(chat, manual)).status).toBe("completed");
    expect((await live(chat)).compactionFailure).toBeUndefined();
    await waitFor(() =>
      events.some((event) => event.type === "compaction_end" && event.taskId === manual),
    );
    expect(
      events.find((event) => event.type === "compaction_end" && event.taskId === manual),
    ).not.toHaveProperty("error");
    await stream.stop();
    await chat.harness.close(context);
  });
});
