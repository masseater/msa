import { rm } from "node:fs/promises";

import { UsageDoc } from "@msa/durable";
import { CompactionTask } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, waitFor } from "./chat-support.ts";
import {
  type Chat,
  text,
  summary,
  answer,
  gated,
  BLOCKING,
  history,
  turn,
  sqlitePath,
  directories,
  first,
  MANUAL,
  reopen,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
  user,
} from "./harness-compaction-support.ts";
import { addHooks } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("compaction recovery", () => {
  it("resends an interrupted summarization once and counts only the answered attempt", async () => {
    const path = await sqlitePath();
    let chat = await first(path);
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    const usageBefore = (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models[
      "faux/faux-1"
    ]!;
    expect((await chat.harness.getTask(id, context))?.state).toMatchObject({
      checkpoint: { phase: "summarize" },
    });
    await chat.harness.close(context);
    chat = await reopen(path, chat.setup, chat.faux);
    chat.faux.summaries.push(summary());
    expect((await result(chat, id)).status).toBe("completed");
    expect(chat.faux.summaryRequests).toHaveLength(2);
    const [, resent] = chat.faux.summaryRequests;
    expect(resent!.messages).toEqual(
      chat.faux.summaryRequests[0]!.messages.map((message) =>
        Object.assign({}, message, { timestamp: expect.any(Number) }),
      ),
    );
    const usage = (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models[
      "faux/faux-1"
    ]!;
    expect(usage.input).toBeGreaterThan(usageBefore.input);
    expect(usage.output - usageBefore.output).toBe(2);
    await chat.harness.close(context);
  });
});

describe("compaction recovery", () => {
  it("resumes a retry backoff after reopen", async () => {
    const path = await sqlitePath();
    let chat = await first(path);
    let now = Date.now();
    chat.setup.now = () => now;
    chat.setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 60_000 };
    chat.faux.summaries.push(failure("overloaded"));
    const id = await chat.root.compact(undefined, context);
    await waitFor(async () => (await live(chat)).compactions?.[0]?.retry !== undefined);
    expect((await chat.harness.getTask(id, context))?.state).toMatchObject({
      checkpoint: { phase: "retry", attempt: 1 },
    });
    await chat.harness.close(context);
    now += 120_000;
    chat = await reopen(path, chat.setup, chat.faux);
    chat.faux.summaries.push(summary());
    expect((await result(chat, id)).status).toBe("completed");
    expect(chat.faux.summaryRequests).toHaveLength(2);
    await chat.harness.close(context);
  });

  it("keeps a generation waiting on its blocking compaction across reopen", async () => {
    const path = await sqlitePath();
    let chat = await first(path);
    const setup = chat.setup;
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    // The faux model window is 128k; this blocking threshold needs a small context window.
    chat.setup.settings.compaction = { ...BLOCKING, reserveTokens: 128_000 - 700 };
    const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
    await reached.promise;
    await chat.harness.close(context);
    chat = await reopen(path, setup, chat.faux);
    chat.faux.summaries.push(summary());
    chat.faux.agent.push(answer("a4"));
    expect((await (await chat.harness.submission(input.id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect((await kinds(chat.root)).slice(-3)).toEqual([
      "msa.compaction",
      "msa.system",
      "msa.assistant",
    ]);
    await chat.harness.close(context);
  });
});

describe("compaction recovery", () => {
  it("keeps a queued summary across reopen and places it at the next boundary", async () => {
    const path = await sqlitePath();
    let chat = await first(path);
    const reached = deferred();
    chat.faux.agent.push(gated(deferred(), answer("never"), reached));
    const input = await chat.root.submit({ type: "input", content: "busy" }, context);
    await reached.promise;
    chat.faux.summaries.push(summary());
    const outcome = await result(chat, await chat.root.compact(undefined, context));
    await chat.harness.close(context);
    chat = await reopen(path, chat.setup, chat.faux);
    chat.faux.agent.push(answer("answered"));
    expect((await (await chat.harness.submission(input.id, context))!.wait(context)).status).toBe(
      "done",
    );
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    expect(
      (await (await chat.harness.submission(submissionId!, context))!.wait(context)).status,
    ).toBe("done");
    await chat.harness.close(context);
  });
});

async function queuedSummary(chat: Chat, content = "SUMMARY") {
  chat.faux.summaries.push(summary(content));
  const outcome = await result(chat, await chat.root.compact(undefined, context));
  return (await chat.harness.submission(
    (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
    context,
  ))!;
}

async function busy(chat: Chat, reply = answer("done")) {
  const gate = deferred();
  const reached = deferred();
  chat.faux.agent.push(gated(gate, reply, reached));
  const input = await chat.root.submit({ type: "input", content: "busy" }, context);
  await reached.promise;
  return { input, release: () => gate.resolve() };
}

describe("compaction and the inbox", () => {
  it("places a reset queued after the summary last, and makes a summary queued after a reset stale", async () => {
    for await (const order of ["summary first", "reset first"] as const) {
      const chat = await open();
      await history(chat);
      const run = await busy(chat);
      let submission: Awaited<ReturnType<typeof queuedSummary>>;
      if (order === "summary first") {
        submission = await queuedSummary(chat);
        await chat.root.reset(undefined, context);
      } else {
        await chat.root.reset(undefined, context);
        submission = await queuedSummary(chat);
      }
      run.release();
      await run.input.wait(context);
      const settled = await submission.wait(context);
      expect(settled.status).toBe(order === "summary first" ? "done" : "unanswered");
      expect((await kinds(chat.root)).at(-1)).toBe("msa.reset");
      expect((await chat.root.context(context)).head?.kind).toBe("msa.reset");
      await chat.harness.close(context);
    }
  });

  it("places a summary left queued by a failed run at the next submission, before its input", async () => {
    const chat = await open();
    await history(chat);
    const run = await busy(chat, failure("bad request"));
    const submission = await queuedSummary(chat);
    run.release();
    expect((await run.input.wait(context)).status).toBe("unanswered");
    expect((await submission.status(context)).status).toBe("queued");
    await turn(chat, "again", "ok");
    expect((await submission.status(context)).status).toBe("done");
    const request = chat.faux.agentRequests.at(-1)!.messages;
    expect(firstUserText(request)).toContain("SUMMARY");
    expect(request.map(userText)).toContain("again");
    await chat.harness.close(context);
  });
});

describe("compaction and the inbox", () => {
  it("keeps the full retry budget after an overflow compaction", async () => {
    const chat = await open();
    await history(chat);
    chat.setup.settings.compaction = { ...MANUAL, enabled: true };
    chat.faux.summaries.push(summary());
    chat.faux.agent.push(
      failure("prompt is too long"),
      failure("overloaded"),
      failure("overloaded"),
      answer("finally"),
    );
    const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
    expect((await input.wait(context)).status).toBe("done");
    await chat.harness.close(context);
  });

  it("loses an application edit placed while a compaction summarizes (spec §12)", async () => {
    const chat = await open();
    await history(chat);
    const [u1] = await allEntries(chat.root);
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary(), reached));
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    const edit = { target: u1!.id, action: "replace", messages: [user("REDACTED")] } as const;
    await chat.root.submit(
      { type: "write", entry: { kind: "app.redact", edits: [edit] } },
      context,
    );
    gate.resolve();
    await result(chat, id);
    // The summary was made from the unredacted entry, and the edit's target left the range.
    expect(userText(chat.faux.summaryRequests[0]!.messages[1])).toContain("[User]: u1 ");
    expect((await chat.root.context(context)).messages.map(userText)).not.toContain("REDACTED");
    await chat.harness.close(context);
  });
});

describe("compaction and the inbox", () => {
  it("keeps the kept entries mounted in the conversation view", async () => {
    const chat = await open();
    await history(chat);
    const state = await chat.root.viewState(context);
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    await waitFor(() => state.value.entries[0]?.kind === "msa.compaction");
    expect(state.value.entries).toEqual((await chat.root.context(context)).entries);
    state.dispose();
    await chat.harness.close(context);
  });
});

describe("compaction edge cases", () => {
  it("keeps the one-compaction limit through a retry backoff", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    let asked = 0;
    addHooks(chat.setup.registry, CompactionTask, {
      beforeCompact: () => {
        asked++;
        return { decline: true };
      },
    });
    chat.faux.agent.push(failure("overloaded"));
    await turn(chat, text("u4", 200), "a4");
    // One blocking compaction, declined; the retried preparation, still above the threshold, started no other.
    expect(asked).toBe(1);
    expect(chat.faux.agentRequests).toHaveLength(5);
    await chat.harness.close(context);
  });
});
