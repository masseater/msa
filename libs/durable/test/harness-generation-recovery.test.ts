import { rm } from "node:fs/promises";

import { type AssistantMessage, fauxAssistantMessage, type Message } from "@msa/ai";
import { AssistantEntry, type Harness, LiveDoc, type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, textOf, waitFor } from "./chat-support.ts";
import { open, directories, sqlitePath } from "./harness-generation-recovery-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function runTaskId(harness: Harness): Promise<TaskId> {
  const live = await harness.snapshot(LiveDoc, 1 as never, context);
  return live!.run!.taskId;
}

async function checkpoint(harness: Harness, id: TaskId) {
  const record = await harness.getTask(id, context);
  return record?.state.status === "terminal" ? undefined : record?.state.checkpoint;
}

async function interruptedBeforePartial() {
  const path = await sqlitePath();
  const setup = chatSetup();
  addSection(setup.registry, "preamble", () => "p", { tag: false });
  const reached = deferred();
  const sent: string[][] = [];
  const timeouts: (number | undefined)[] = [];
  setup.faux.setResponses([
    (_context, options) => {
      reached.resolve();
      return Promise.resolve(aborted(options!.signal!));
    },
    (request, options) => {
      sent.push(request.messages.map((message) => message.role));
      timeouts.push(options?.timeoutMs);
      return fauxAssistantMessage("answer");
    },
  ]);
  const opened = await open(path, setup);
  setup.settings.stream = { timeoutMs: 1234 };
  opened.harness.resume();
  const id = (await opened.root.submit({ type: "input", content: "hi" }, context)).id;
  await reached.promise;
  const taskId = await runTaskId(opened.harness);
  await opened.harness.close(context);
  return { path, setup, sent, timeouts, id, taskId };
}

describe("generation recovery", () => {
  it("reruns preparation interrupted before its commit", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const reached = deferred();
    let block = true;
    addSection(setup.registry, "preamble", async (_input, ctx) => {
      if (block) {
        block = false;
        reached.resolve();
        await aborted(ctx.abortSignal!);
      }
      return "p";
    });
    setup.faux.setResponses([fauxAssistantMessage("answer")]);
    let opened = await open(path, setup);
    opened.harness.resume();
    const id = (await opened.root.submit({ type: "input", content: "hi" }, context)).id;
    await reached.promise;
    const taskId = await runTaskId(opened.harness);
    await opened.harness.close(context);

    opened = await open(path, setup);
    expect(await checkpoint(opened.harness, taskId)).toEqual({ phase: "prepare", attempt: 1 });
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect((await allEntries(opened.root)).map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.system",
      "msa.assistant",
    ]);
    await opened.harness.close(context);
  });
});

describe("generation recovery", () => {
  it("resends a request interrupted before any partial without repeating preparation", async () => {
    const { path, setup, sent, timeouts, id, taskId } = await interruptedBeforePartial();

    const reopened = await open(path, setup);
    expect(await checkpoint(reopened.harness, taskId)).toMatchObject({
      phase: "request",
      attempt: 1,
      thinkingLevel: "off",
      streamOptions: { timeoutMs: 1234 },
    });
    // The resend uses the pinned request, not options changed after preparation.
    setup.settings.stream = { timeoutMs: 999 };
    expect(await reopened.harness.snapshot(LiveDoc, reopened.root.id, context)).toMatchObject({
      generation: { attempt: 1 },
    });
    reopened.harness.resume();
    expect((await (await reopened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(sent).toEqual([["system", "user"]]);
    expect(timeouts).toEqual([1234]);
    expect((await allEntries(reopened.root)).map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.system",
      "msa.assistant",
    ]);
    await reopened.harness.close(context);
  });
});

describe("generation recovery", () => {
  it("converts a committed partial into an aborted entry and resends the same messages", async () => {
    const path = await sqlitePath();
    const slow = chatSetup({ tokensPerSecond: 20, tokenSize: { min: 1, max: 1 } });
    slow.faux.setResponses([fauxAssistantMessage("z".repeat(400))]);
    let opened = await open(path, slow);
    opened.harness.resume();
    const watch = (await opened.harness.watchDoc(LiveDoc, opened.root.id, context))!;
    let watched: string | undefined;
    watch.start((value) => {
      watched = textOf(value?.generation?.message as Message) ?? watched;

      return Promise.resolve();
    });
    const id = (await opened.root.submit({ type: "input", content: "hi" }, context)).id;
    await waitFor(() => watched !== undefined);
    await opened.harness.close(context);

    const setup = chatSetup();
    const sent: string[][] = [];
    setup.faux.setResponses([
      (request) => {
        sent.push(request.messages.map((message) => message.role));
        return fauxAssistantMessage("answer");
      },
    ]);
    opened = await open(path, setup);
    const stored = await opened.harness.snapshot(LiveDoc, opened.root.id, context);
    const partial = textOf(stored?.generation?.message as Message)!;
    // Everything observers saw before the crash is durable.
    expect(partial.startsWith(watched!)).toBe(true);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(sent).toEqual([["user"]]);
    const entries = await allEntries(opened.root);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.assistant",
      "msa.assistant",
    ]);
    const converted = entries[1]!.model![0] as AssistantMessage;
    expect(converted.stopReason).toBe("aborted");
    expect(textOf(converted)).toBe(partial);
    expect(await opened.harness.snapshot(LiveDoc, opened.root.id, context)).toEqual({});
    await opened.harness.close(context);
  });
});

describe("generation recovery", () => {
  it("resumes a retry backoff after reopen", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    let now = 1_000;
    setup.now = () => now;
    setup.faux.setResponses([
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "503 Service Unavailable" }),
      fauxAssistantMessage("recovered"),
    ]);
    let opened = await open(path, setup);
    opened.harness.resume();
    setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 60_000 };
    const id = (await opened.root.submit({ type: "input", content: "hi" }, context)).id;
    await waitFor(async () => {
      const live = await opened.harness.snapshot(LiveDoc, opened.root.id, context);
      return live?.generation?.retry !== undefined;
    });
    const taskId = await runTaskId(opened.harness);
    await opened.harness.close(context);

    opened = await open(path, setup);
    expect(await checkpoint(opened.harness, taskId)).toEqual({
      phase: "retry",
      attempt: 1,
      until: 61_000,
    });
    expect(await opened.harness.snapshot(LiveDoc, opened.root.id, context)).toEqual({
      run: { taskId, inputs: [id] },
      generation: { attempt: 1, retry: { at: 61_000, error: "503 Service Unavailable" } },
    });
    now = 61_000;
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect((await allEntries(opened.root)).map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.assistant",
      "msa.assistant",
    ]);
    await opened.harness.close(context);
  });
});

describe("generation recovery", () => {
  it("resumes polling a deferred response after reopen", async () => {
    const path = await sqlitePath();
    const setup = chatSetup({ deferred: { pollAfterMs: 60_000 } });
    let now = 1_000;
    setup.now = () => now;
    setup.faux.setResponses([fauxAssistantMessage("deferred answer")]);
    let opened = await open(path, setup);
    opened.harness.resume();
    setup.settings.stream = { deferred: true };
    const id = (await opened.root.submit({ type: "input", content: "hi" }, context)).id;
    await waitFor(async () => {
      const live = await opened.harness.snapshot(LiveDoc, opened.root.id, context);
      return live?.generation?.deferred !== undefined;
    });
    const taskId = await runTaskId(opened.harness);
    await opened.harness.close(context);

    opened = await open(path, setup);
    expect(await checkpoint(opened.harness, taskId)).toMatchObject({
      phase: "poll",
      attempt: 1,
      pollAt: 61_000,
    });
    now = 61_000;
    opened.harness.resume();
    const settled = await (await opened.harness.submission(id, context))!.wait(context);
    if (settled.status !== "done" || settled.type !== "input")
      throw new Error(`Unexpected ${settled.status}`);
    const answer = await opened.root.commit(
      (tx) => tx.entry(AssistantEntry, settled.answer),
      context,
    );
    expect(textOf(answer?.model?.[0])).toBe("deferred answer");
    expect(setup.faux.state.deferredFetchCount).toBe(1);
    await opened.harness.close(context);
  });
});
