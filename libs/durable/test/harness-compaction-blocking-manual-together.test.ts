import { rm } from "node:fs/promises";

import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import { type AgentEvent, CompactionTask, LiveDoc, UsageDoc, watchEvents } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
import {
  blockingRun,
  text,
  summary,
  answer,
  gated,
  BLOCKING,
  history,
  turn,
  sqlitePath,
  directories,
  script,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("blocking and manual compaction together", () => {
  it("places a manual summary selected before the blocking one landed; its equal cut replaces it", async () => {
    const chat = await open({ contextWindow: 1000 });
    const run = await blockingRun(chat);
    // Selected from the same context as the blocking compaction, so it cuts at the same entry.
    chat.faux.summaries.push(summary("MANUAL"));
    const manual = await result(chat, await chat.root.compact(undefined, context));
    const submission = (await chat.harness.submission(
      (manual.status === "completed" ? manual.result.submissionId : undefined)!,
      context,
    ))!;
    expect((await submission.status(context)).status).toBe("queued");
    chat.faux.agent.push(answer("a4"));
    run.gate.resolve();
    expect((await run.input.wait(context)).status).toBe("done");
    // The request after the blocking compaction used its summary; the manual one landed at the final boundary.
    expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toContain("BLOCKING");
    expect((await submission.wait(context)).status).toBe("done");
    const markers = (await allEntries(chat.root)).filter(
      (record) => record.kind === "msa.compaction",
    );
    expect(markers).toHaveLength(2);
    expect(markers[1]!.head).toBe(markers[0]!.head);
    const messages = (await chat.root.context(context)).messages;
    expect(firstUserText(messages)).toContain("MANUAL");
    expect(messages.some((message) => userText(message).includes("BLOCKING"))).toBe(false);
    await chat.harness.close(context);
  });

  it("finds nothing to compact for a manual compaction selected after the blocking summary landed", async () => {
    const chat = await open({ contextWindow: 1000 });
    const run = await blockingRun(chat);
    const answerGate = deferred();
    const answerReached = deferred();
    chat.faux.agent.push(gated(answerGate, answer("a4"), answerReached));
    run.gate.resolve();
    await answerReached.promise;
    expect(await result(chat, await chat.root.compact(undefined, context))).toEqual({
      status: "completed",
      result: {},
    });
    expect(chat.faux.summaryRequests).toHaveLength(1);
    answerGate.resolve();
    expect((await run.input.wait(context)).status).toBe("done");
    await chat.harness.close(context);
  });
});

describe("blocking and manual compaction together", () => {
  it("aborts the run and both compactions on Esc and appends nothing", async () => {
    const chat = await open({ contextWindow: 1000 });
    const run = await blockingRun(chat);
    const manualReached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary("MANUAL"), manualReached));
    const manual = await chat.root.compact(undefined, context);
    await manualReached.promise;
    expect((await live(chat)).compactions?.map((status) => status.blocking)).toEqual([true, false]);
    await chat.root.abort(context);
    expect(await run.input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect((await result(chat, run.blocking)).status).toBe("aborted");
    expect((await result(chat, manual)).status).toBe("aborted");
    expect((await live(chat)).compactions).toBeUndefined();
    expect((await live(chat)).run).toBeUndefined();
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    expect((await chat.harness.inspect(context)).submissions).toEqual([]);
    await chat.harness.close(context);
  });

  it("places a summary that survived Esc at the next submission, before its input", async () => {
    const chat = await open();
    await history(chat);
    const reached = deferred();
    chat.faux.agent.push(gated(deferred(), answer("never"), reached));
    const busy = await chat.root.submit({ type: "input", content: "busy" }, context);
    await reached.promise;
    chat.faux.summaries.push(summary());
    const outcome = await result(chat, await chat.root.compact(undefined, context));
    const submission = (await chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ))!;
    await chat.root.abort(context);
    expect(await busy.wait(context)).toMatchObject({ status: "unanswered", reason: "aborted" });
    expect((await submission.status(context)).status).toBe("queued");
    await turn(chat, "u5", "a5");
    expect((await submission.status(context)).status).toBe("done");
    const request = chat.faux.agentRequests.at(-1)!.messages;
    expect(firstUserText(request)).toContain("SUMMARY");
    expect(request.map(userText)).toContain("u5");
    const tail = (await allEntries(chat.root)).slice(-4).map((record) => record.kind);
    expect(tail).toEqual(["msa.compaction", "msa.user", "msa.system", "msa.assistant"]);
    await chat.harness.close(context);
  });
});

describe("compaction pinning, silent overflow, and late policy changes", () => {
  it("keeps the pinned model through a retry and advances the live attempt", async () => {
    const setup = chatSetup({
      models: [
        { id: "faux-1", contextWindow: 100_000, maxTokens: 900 },
        { id: "faux-2", contextWindow: 100_000, maxTokens: 900 },
      ],
    });
    const chat = await open({}, setup);
    await history(chat);
    let attempt: number | undefined;
    chat.faux.summaries.push(async () => {
      // Switched during the attempt: the retry still uses the pinned model.
      await chat.root.configure({ model: { provider: "faux", modelId: "faux-2" } }, context);
      return failure("overloaded");
    });
    chat.faux.summaries.push(async () => {
      attempt = (await live(chat)).compactions?.[0]?.attempt;
      return summary();
    });
    expect((await result(chat, await chat.root.compact(undefined, context))).status).toBe(
      "completed",
    );
    expect(chat.faux.summaryRequests.map((request) => request.model)).toEqual(["faux-1", "faux-1"]);
    expect(attempt).toBe(2);
    const usage = (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models;
    expect(Object.keys(usage)).toEqual(["faux/faux-1"]);
    await chat.harness.close(context);
  });

  it("shows a late joiner a compaction that is summarizing", async () => {
    const chat = await open();
    await history(chat);
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    expect(stream.snapshot.compactions).toEqual([
      { taskId: id, reason: "manual", blocking: false, attempt: 1 },
    ]);
    await stream.stop();
    await chat.harness.abortTask(id, context);
    await chat.harness.close(context);
  });
});

describe("compaction pinning, silent overflow, and late policy changes", () => {
  for (const [name, response] of [
    ["a stop whose input exceeds the window", answer("fine")],
    [
      "a length stop that fills the window without output",
      fauxAssistantMessage("", { stopReason: "length" }),
    ],
  ] as const) {
    it(`treats silent overflow as an ordinary answer: ${name}`, async () => {
      const chat = await open({ contextWindow: 300 });
      await history(chat);
      // Thresholds out of reach, so only overflow classification could compact.
      chat.setup.settings.compaction = {
        enabled: true,
        reserveTokens: -100_000,
        keepRecentTokens: 150,
        backgroundTokens: 0,
      };
      chat.faux.agent.push(response);
      const input = await chat.root.submit({ type: "input", content: "go" }, context);
      expect((await input.wait(context)).status).toBe("done");
      const [last] = (await allEntries(chat.root)).slice(-1);
      const message = last!.model![0] as AssistantMessage;
      expect(message.usage.input).toBeGreaterThanOrEqual(300);
      expect(chat.faux.summaryRequests).toHaveLength(0);
      await chat.harness.close(context);
    });
  }
});

describe("compaction pinning, silent overflow, and late policy changes", () => {
  it("sends the request when a blocking compaction finds nothing under a policy changed after preparation", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    let changed = false;
    addSection(chat.setup.registry, "policy", () => {
      // Rendering runs after preparation read the policy; the compaction reads this one.
      if (!changed) {
        changed = true;
        chat.setup.settings.compaction = { ...BLOCKING, keepRecentTokens: 100_000 };
      }
      return Promise.resolve("p");
    });
    await turn(chat, text("u4", 200), "a4");
    const compactions = (await chat.harness.inspect(context)).tasks.filter(
      (task) => task.record.kind === "msa.compaction",
    );
    expect(compactions).toEqual([]);
    expect(chat.faux.summaryRequests).toHaveLength(0);
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    await chat.harness.close(context);
  });
});

describe("blocked compaction", () => {
  it("survives reopen blocked and is orphaned on abort with its status removed", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    let { harness, root } = await openChat(await openNodeSqliteStorage(path), setup);
    // A compaction stored by a newer version than this process registers, for example after a downgrade.
    const newer = {
      definition: { ...CompactionTask.definition, version: 2 },
    } as typeof CompactionTask;
    const id = await root.commit(async (tx) => {
      const taskId = await tx.createTask(
        newer,
        { reason: "manual" },
        { ownership: { kind: "conversation" } },
      );
      const live = await tx.doc(LiveDoc, root.id);
      live.compactions = [{ taskId, reason: "manual", blocking: false, attempt: 1 }];
      return taskId;
    }, context);
    await harness.close(context);
    ({ harness, root } = await openChat(await openNodeSqliteStorage(path), setup));
    harness.resume();
    const chat = { harness, root, setup, faux: script(setup) };
    const events: AgentEvent[] = [];
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    stream.start((batch) => {
      events.push(...batch);

      return Promise.resolve();
    });
    const inspection = await chat.harness.inspect(context);
    expect(inspection.tasks.find((task) => task.record.id === id)?.state).toEqual({
      kind: "blocked",
      reason: "task_too_old",
    });
    await chat.harness.abortTask(id, context);
    expect((await chat.harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "orphaned",
      reason: "task_too_old",
    });
    expect((await live(chat)).compactions).toBeUndefined();
    await waitFor(() => events.some((event) => event.type === "compaction_end"));
    await stream.stop();
    await chat.harness.close(context);
  });
});
