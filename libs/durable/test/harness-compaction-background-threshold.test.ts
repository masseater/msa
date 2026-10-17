import { rm } from "node:fs/promises";

import {
  type AgentEvent,
  type CompactionResult,
  CompactionTask,
  type TaskId,
  watchEvents,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, waitFor } from "./chat-support.ts";
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
  OVERFLOW,
  BACKGROUND,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
  ENABLED,
} from "./harness-compaction-support.ts";
import { addHooks, addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("background threshold compaction", () => {
  it("stops through abortTask() and Conversation.abort() with background", async () => {
    for await (const stop of ["task", "conversation"] as const) {
      const chat = await open({ contextWindow: 2000 });
      await history(chat);
      chat.setup.settings.compaction = BACKGROUND;
      const reached = deferred();
      chat.faux.summaries.push(gated(deferred(), summary(), reached));
      await turn(chat, text("u4", 100), text("a4", 100));
      await reached.promise;
      const [task] = await compactionTasks(chat);
      if (stop === "task") await chat.harness.abortTask(task!.id, context);
      else await chat.root.abort(context, { background: true });
      expect((await result(chat, task!.id as TaskId<CompactionResult>)).status).toBe("aborted");
      expect((await live(chat)).compactions).toBeUndefined();
      await chat.harness.close(context);
    }
  });
});

describe("blocking threshold compaction", () => {
  it("waits for its compaction, which appends the summary before the request", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    // A new section: preparation has a system entry to append, but must not append it before the wait.
    addSection(chat.setup.registry, "extra", () => "EXTRA");
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary(), reached));
    chat.faux.agent.push(answer("a4"));
    const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
    await reached.promise;
    const [child] = await compactionTasks(chat);
    const generation = (await live(chat)).run!.taskId;
    expect(child).toMatchObject({
      owner: generation,
      background: false,
      input: { reason: "threshold" },
    });
    expect((await chat.harness.getTask(generation, context))?.state).toMatchObject({
      status: "waiting",
      on: [child!.id],
      checkpoint: { phase: "prepare", attempt: 1, compacted: child!.id },
    });
    expect((await live(chat)).compactions).toEqual([
      { taskId: child!.id, reason: "threshold", blocking: true, attempt: 1 },
    ]);
    // Nothing was appended before the wait.
    expect((await kinds(chat.root)).at(-1)).toBe("msa.user");
    gate.resolve();
    expect((await input.wait(context)).status).toBe("done");
    expect((await result(chat, child!.id as TaskId<CompactionResult>)).status).toBe("completed");
    expect((await kinds(chat.root)).slice(-3)).toEqual([
      "msa.compaction",
      "msa.system",
      "msa.assistant",
    ]);
    const request = chat.faux.agentRequests.at(-1)!.messages;
    expect(firstUserText(request)).toContain("SUMMARY");
    const systems = request.filter((message) => message.role === "system");
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({
      sections: { preamble: "You are helpful.", extra: "<extra>\nEXTRA\n</extra>" },
    });
    await chat.harness.close(context);
  });
});

describe("blocking threshold compaction", () => {
  it("sends the request once, without a second compaction, when the kept part is still above the threshold", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = { ...BLOCKING, keepRecentTokens: 700 };
    chat.faux.summaries.push(summary());
    await turn(chat, text("u4", 400), "a4");
    expect(chat.faux.summaryRequests).toHaveLength(1);
    expect((await kinds(chat.root)).filter((kind) => kind === "msa.compaction")).toHaveLength(1);
    await chat.harness.close(context);
  });

  it("sends the request anyway when its compaction declines", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) });
    await turn(chat, text("u4", 200), "a4");
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toBe(text("u1", 100));
    expect((await live(chat)).compactionFailure).toBeUndefined();
    await chat.harness.close(context);
  });

  // A failed compaction leaves a context it judged too large; sending it once filled a 1M window and got an empty
  // `length` answer on every turn while the failure stayed invisible.
  it("fails the run with the compaction's error, without a request, when its compaction fails", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    chat.faux.summaries.push(failure("bad request"));
    const requests = chat.faux.agentRequests.length;
    const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: "Compaction failed: Summarization failed: bad request",
    });
    expect(chat.faux.agentRequests).toHaveLength(requests);
    expect((await kinds(chat.root)).at(-1)).toBe("msa.user");
    const state = await live(chat);
    expect(state.compactions).toBeUndefined();
    expect(state.compactionFailure).toMatchObject({
      reason: "threshold",
      error: "Summarization failed: bad request",
    });
    await chat.harness.close(context);
  });
});

describe("blocking threshold compaction", () => {
  it("fails the run when its compaction is aborted directly", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    const requests = chat.faux.agentRequests.length;
    const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
    await reached.promise;
    const [child] = await compactionTasks(chat);
    await chat.harness.abortTask(child!.id, context);
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: "Compaction was aborted",
    });
    expect(chat.faux.agentRequests).toHaveLength(requests);
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    // Aborting is not a failure.
    expect((await live(chat)).compactionFailure).toBeUndefined();
    await chat.harness.close(context);
  });
});

describe("blocking threshold compaction", () => {
  it("is aborted with its generation by Esc, before the generation's abort handler", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    const events: AgentEvent[] = [];
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    stream.start((batch) => {
      events.push(...batch);

      return Promise.resolve();
    });
    const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
    await reached.promise;
    const [child] = await compactionTasks(chat);
    await chat.root.abort(context);
    expect(await input.wait(context)).toMatchObject({ status: "unanswered", reason: "aborted" });
    expect((await chat.harness.getTask(child!.id, context))?.state).toMatchObject({
      outcome: { status: "aborted" },
    });
    await waitFor(() => events.some((event) => event.type === "run_end"));
    const types = events.map((event) => event.type);
    expect(types.indexOf("compaction_end")).toBeLessThan(types.indexOf("run_end"));
    await stream.stop();
    await chat.harness.close(context);
  });
});

describe("blocking threshold compaction", () => {
  it("wins over a background compaction still in flight, which then settles stale", async () => {
    const chat = await open({ contextWindow: 2000 });
    await history(chat);
    chat.setup.settings.compaction = BACKGROUND;
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary("BACKGROUND"), reached));
    await turn(chat, text("u4", 100), text("a4", 100));
    await reached.promise;
    const [background] = await compactionTasks(chat);
    chat.faux.summaries.push(summary("BLOCKING"));
    await turn(chat, text("u5", 1000), "a5");
    expect(firstUserText((await chat.root.context(context)).messages)).toContain("BLOCKING");
    gate.resolve();
    const outcome = await result(chat, background!.id as TaskId<CompactionResult>);
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    expect(
      await (await chat.harness.submission(submissionId!, context))!.status(context),
    ).toMatchObject({
      status: "unanswered",
      reason: "stale",
    });
    await chat.harness.close(context);
  });
});

describe("overflow compaction", () => {
  it("compacts and retries with the same attempt, leaving the error out of the retry", async () => {
    const chat = await open();
    await history(chat);
    chat.setup.settings.compaction = ENABLED;
    chat.faux.summaries.push(summary());
    let attempt: number | undefined;
    chat.faux.agent.push(failure(OVERFLOW));
    chat.faux.agent.push(async () => {
      attempt = (await live(chat)).generation?.attempt;
      return answer("fits");
    });
    const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
    expect((await input.wait(context)).status).toBe("done");
    expect(attempt).toBe(1);
    expect((await kinds(chat.root)).slice(-5)).toEqual([
      "msa.user",
      "msa.assistant",
      "msa.compaction",
      "msa.system",
      "msa.assistant",
    ]);
    const [compaction] = (await allEntries(chat.root)).filter(
      (record) => record.kind === "msa.compaction",
    );
    expect(compaction).toMatchObject({ data: { reason: "overflow" } });
    const retry = chat.faux.agentRequests.at(-1)!.messages;
    expect(retry[0]?.role).toBe("system");
    expect(userText(retry[1])).toContain("SUMMARY");
    expect(
      retry.some((message) => message.role === "assistant" && message.stopReason === "error"),
    ).toBe(false);
    await chat.harness.close(context);
  });
});
