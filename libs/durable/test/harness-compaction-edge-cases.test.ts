import { rm } from "node:fs/promises";

import { fauxAssistantMessage } from "@msa/ai";
import { type AgentEvent, type CompactionResult, type TaskId, UsageDoc } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openChat, waitFor } from "./chat-support.ts";
import {
  compactionTasks,
  text,
  summary,
  answer,
  gated,
  BLOCKING,
  history,
  turn,
  directories,
  MANUAL,
  OVERFLOW,
  BACKGROUND,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addSection } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("compaction edge cases", () => {
  it("does not start a background compaction when a manual one was admitted during preparation", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    chat.setup.settings.compaction = BACKGROUND;
    const rendering = deferred();
    const release = deferred();
    let hold = true;
    addSection(chat.setup.registry, "slow", async () => {
      if (hold) {
        hold = false;
        rendering.resolve();
        await release.promise;
      }
      return "slow";
    });
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    chat.faux.agent.push(answer("a4"));
    const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
    await rendering.promise;
    const manual = await chat.root.compact(undefined, context);
    await reached.promise;
    release.resolve();
    expect((await input.wait(context)).status).toBe("done");
    expect((await compactionTasks(chat)).map((task) => task.id)).toEqual([manual]);
    // A background compaction would have sent its own summarization request.
    expect(chat.faux.summaryRequests).toHaveLength(1);
    await chat.harness.abortTask(manual, context);
    await chat.harness.close(context);
  });

  it("starts no background compaction after a blocking one in the same generation", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    // Blocking at 1500, background at 200: the kept part stays above the background threshold.
    chat.setup.settings.compaction = {
      ...BACKGROUND,
      backgroundTokens: 1300,
      keepRecentTokens: 400,
    };
    chat.faux.summaries.push(summary());
    await turn(chat, text("u4", 1000), "a4");
    expect(chat.faux.summaryRequests).toHaveLength(1);
    expect(await compactionTasks(chat)).toEqual([]);
    await chat.harness.close(context);
  });
});

describe("compaction edge cases", () => {
  it("fails the run when its blocking compaction faults, and records the fault", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    const completeSimple = chat.setup.models.completeSimple.bind(chat.setup.models);
    chat.setup.models.completeSimple = () => {
      throw new Error("no credentials");
    };
    const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: "Compaction failed: no credentials",
    });
    chat.setup.models.completeSimple = completeSimple;
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    const state = await live(chat);
    expect(state.compactions).toBeUndefined();
    expect(state.compactionFailure).toMatchObject({ reason: "threshold", error: "no credentials" });
    await chat.harness.close(context);
  });

  it("fails an overflow run with its text when its compaction is aborted directly or itself overflows", async () => {
    for await (const how of ["abort", "overflow"] as const) {
      const chat = await open();
      await history(chat);
      chat.setup.settings.compaction = { ...MANUAL, enabled: true };
      const reached = deferred();
      if (how === "abort") chat.faux.summaries.push(gated(deferred(), summary(), reached));
      else chat.faux.summaries.push(failure("prompt is too long for the summary"));
      chat.faux.agent.push(failure(OVERFLOW));
      const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
      if (how === "abort") {
        await reached.promise;
        const [child] = await compactionTasks(chat);
        await chat.harness.abortTask(child!.id, context);
      }
      expect(await input.wait(context)).toMatchObject({
        status: "unanswered",
        reason: "model_error",
        detail: OVERFLOW,
      });
      expect((await live(chat)).compactions).toBeUndefined();
      await chat.harness.close(context);
    }
  });
});

describe("compaction edge cases", () => {
  it("treats a length stop as an ordinary answer, not an overflow", async () => {
    const chat = await open();
    await history(chat);
    chat.setup.settings.compaction = { ...MANUAL, enabled: true };
    chat.faux.agent.push(
      fauxAssistantMessage("cut short", { stopReason: "length", errorMessage: OVERFLOW }),
    );
    const input = await chat.root.submit({ type: "input", content: "go" }, context);
    expect((await input.wait(context)).status).toBe("done");
    expect(chat.faux.summaryRequests).toHaveLength(0);
    await chat.harness.close(context);
  });

  it("orders the events of a summary placed at once", async () => {
    const chat = await open();
    await history(chat);
    const events: AgentEvent[] = [];
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    stream.start((batch) => {
      events.push(...batch);

      return Promise.resolve();
    });
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    await waitFor(() => events.some((event) => event.type === "compaction_end"));
    const end = events.findIndex((event) => event.type === "compaction_end");
    const batch = events.slice(end - 2, end + 3).map((event) => event.type);
    expect(batch).toEqual([
      "message_start",
      "message_end",
      "compaction_end",
      "submission",
      "usage_changed",
    ]);
    await stream.stop();
    await chat.harness.close(context);
  });
});

describe("compaction edge cases", () => {
  it("puts compaction_start last in the batch of the preparation commit", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    chat.setup.settings.compaction = BACKGROUND;
    const events: AgentEvent[][] = [];
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    stream.start((batch) => {
      events.push([...batch]);

      return Promise.resolve();
    });
    // A new section makes the preparation commit append a system entry next to the compaction's status.
    addSection(chat.setup.registry, "extra", () => "extra");
    chat.faux.summaries.push(gated(deferred(), summary()));
    await turn(chat, text("u4", 100), "a4");
    await waitFor(() =>
      events.some((batch) => batch.some((event) => event.type === "compaction_start")),
    );
    const batch = events.find((candidate) =>
      candidate.some((event) => event.type === "compaction_start"),
    )!;
    expect(batch.map((event) => event.type)).toEqual([
      "message_start",
      "message_end",
      "compaction_start",
    ]);
    await stream.stop();
    await chat.harness.abortTask((await compactionTasks(chat))[0]!.id, context);
    await chat.harness.close(context);
  });
});

describe("compaction edge cases", () => {
  it("keeps a background summary queued through a retry backoff while a blocking compaction wins", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    chat.setup.settings.compaction = BACKGROUND;
    chat.setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 300 };
    const summaryGate = deferred();
    const summaryReached = deferred();
    chat.faux.summaries.push(gated(summaryGate, summary("BACKGROUND"), summaryReached));
    chat.faux.summaries.push(summary("BLOCKING"));
    const failed = deferred();
    chat.faux.agent.push(() => {
      failed.resolve();
      return Promise.resolve(failure("overloaded"));
    });
    chat.faux.agent.push(answer("a4"));
    const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
    await Promise.all([failed.promise, summaryReached.promise]);
    // During the backoff: the background summary queues, and the thresholds drop so the retry blocks.
    await waitFor(async () => (await live(chat)).generation?.retry !== undefined);
    const [background] = await compactionTasks(chat);
    summaryGate.resolve();
    const queued = await result(chat, background!.id as TaskId<CompactionResult>);
    const submission = (await chat.harness.submission(
      (queued.status === "completed" ? queued.result.submissionId : undefined)!,
      context,
    ))!;
    expect((await submission.status(context)).status).toBe("queued");
    chat.setup.settings.compaction = { ...BACKGROUND, reserveTokens: 1500, keepRecentTokens: 50 };
    expect((await input.wait(context)).status).toBe("done");
    expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toContain("BLOCKING");
    expect(await submission.wait(context)).toMatchObject({ status: "unanswered", reason: "stale" });
    await chat.harness.close(context);
  });
});

describe("compaction edge cases", () => {
  it("summarizes the previous summary in a second compaction", async () => {
    const chat = await open();
    await history(chat);
    chat.faux.summaries.push(summary("FIRST"));
    await result(chat, await chat.root.compact(undefined, context));
    await turn(chat, text("u4", 100), text("a4", 100));
    await turn(chat, text("u5", 100), text("a5", 100));
    chat.faux.summaries.push(summary("SECOND"));
    await result(chat, await chat.root.compact(undefined, context));
    const prompt = userText(chat.faux.summaryRequests[1]!.messages[1]);
    expect(prompt).toMatch(
      /^<conversation>\n\[User\]: The conversation history before this point was compacted/u,
    );
    expect(prompt).toContain("FIRST");
    expect(firstUserText((await chat.root.context(context)).messages)).toContain("SECOND");
    await chat.harness.close(context);
  });

  it("leaves no usage, submission, or summary when the classifying commit fails, which fails the Harness", async () => {
    const storage = new ControlledStorage();
    const chat = await open({ storage });
    await history(chat);
    const usage = async () =>
      (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models["faux/faux-1"];
    const before = await usage();
    const failure = new Error("disk gone");
    chat.faux.summaries.push(() => {
      storage.failNextCommit(failure);
      return Promise.resolve(summary());
    });
    const id = await chat.root.compact(undefined, context);
    expect(await chat.harness.closed).toEqual({ reason: "failed", error: failure });
    await chat.harness.close(context);
    // Nothing of the failed commit landed: the task is still live, without usage, entry, or submission.
    storage.reopen();
    expect(
      await storage.submissionByRequest(chat.root.id, `compaction:${id}`, context),
    ).toBeUndefined();
    expect((await storage.task(id, context))?.state.status).not.toBe("terminal");
    const reopened = await openChat(storage, chat.setup);
    expect(
      (await reopened.harness.snapshot(UsageDoc, reopened.root.id, context))!.models["faux/faux-1"],
    ).toEqual(before);
    expect((await kinds(reopened.root)).includes("msa.compaction")).toBe(false);
    await reopened.harness.close(context);
  });
});
