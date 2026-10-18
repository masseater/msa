import { rm } from "node:fs/promises";

import { type Message } from "@msa/ai";
import { type EntryRecord, UsageDoc } from "@msa/durable";
import { CompactionTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import {
  text,
  summary,
  answer,
  gated,
  history,
  turn,
  directories,
  MANUAL,
  script,
  live,
  firstUserText,
  userText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addHooks } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("manual compaction", () => {
  it("counts the spend of a summary that ends stale, and writes no entry for it", async () => {
    const chat = await open();
    await history(chat);
    const input = async () =>
      (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models["faux/faux-1"]!.input;
    const before = await input();
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary(), reached));
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    await chat.root.reset(undefined, context);
    gate.resolve();
    const outcome = await result(chat, id);
    const submission = (await chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ))!;
    expect(await submission.status(context)).toMatchObject({
      status: "unanswered",
      reason: "stale",
    });
    expect(await input()).toBeGreaterThan(before);
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    await chat.harness.close(context);
  });
});

describe("manual compaction", () => {
  it("lets the compaction that cuts furthest win, whatever finishes first", async () => {
    const chat = await open();
    await history(chat);
    const first = deferred();
    const firstReached = deferred();
    chat.faux.summaries.push(gated(first, summary("FIRST"), firstReached));
    const early = await chat.root.compact(undefined, context);
    await firstReached.promise;
    await turn(chat, text("u4", 100), text("a4", 100));
    chat.faux.summaries.push(summary("SECOND"));
    const later = await result(chat, await chat.root.compact(undefined, context));
    expect(later.status).toBe("completed");
    first.resolve();
    const outcome = await result(chat, early);
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    // The early compaction cut at u3, before the later cut at u4.
    expect(
      await (await chat.harness.submission(submissionId!, context))!.status(context),
    ).toMatchObject({
      status: "unanswered",
      reason: "stale",
    });
    expect(firstUserText((await chat.root.context(context)).messages)).toContain("SECOND");
    await chat.harness.close(context);
  });
});

describe("manual compaction", () => {
  it("places an older-selected summary that cuts later than the newer one", async () => {
    const chat = await open();
    await history(chat);
    // A: small budget, late cut; selected first, finishes last.
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary("A"), reached));
    const a = await chat.root.compact(undefined, context);
    await reached.promise;
    // B: larger budget, earlier cut; placed first.
    chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: 350 };
    chat.faux.summaries.push(summary("B"));
    await result(chat, await chat.root.compact(undefined, context));
    expect(firstUserText((await chat.root.context(context)).messages)).toContain("B");
    gate.resolve();
    const outcome = await result(chat, a);
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    expect(
      (await (await chat.harness.submission(submissionId!, context))!.status(context)).status,
    ).toBe("done");
    const messages = (await chat.root.context(context)).messages;
    expect(firstUserText(messages)).toContain("<summary>\nA\n</summary>");
    expect(messages.slice(1).map(userText)).toEqual([text("u3", 100), text("a3", 100)]);
    await chat.harness.close(context);
  });
});

describe("manual compaction", () => {
  for (const [order, keeps, stale] of [
    ["before", [150, 350], true],
    ["at", [150, 150], false],
    ["after", [350, 150], false],
  ] as const) {
    it(`places two queued summaries in one boundary when the second cuts ${order} the first`, async () => {
      const chat = await open();
      await history(chat);
      const gate = deferred();
      const reached = deferred();
      chat.faux.agent.push(gated(gate, answer("done"), reached));
      const input = await chat.root.submit({ type: "input", content: "busy" }, context);
      await reached.promise;
      const submissions = [];
      for await (const [index, keep] of keeps.entries()) {
        chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: keep };
        chat.faux.summaries.push(summary(`S${index}`));
        const outcome = await result(chat, await chat.root.compact(undefined, context));
        submissions.push(outcome.status === "completed" ? outcome.result.submissionId! : undefined);
      }
      gate.resolve();
      await input.wait(context);
      const statuses = [];
      for await (const id of submissions)
        statuses.push((await (await chat.harness.submission(id!, context))!.wait(context)).status);
      expect(statuses).toEqual(["done", stale ? "unanswered" : "done"]);
      await chat.harness.close(context);
    });
  }
});

describe("manual compaction", () => {
  it("is aborted by Conversation.abort(); an already queued summary survives it", async () => {
    const chat = await open();
    await history(chat);
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    expect((await live(chat)).compactions).toHaveLength(1);
    await chat.root.abort(context);
    expect((await result(chat, id)).status).toBe("aborted");
    expect((await live(chat)).compactions).toBeUndefined();
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);

    // Queued while busy, then Esc: the queued write stays and lands with the next run's boundary.
    const gate = deferred();
    const busy = deferred();
    chat.faux.agent.push(gated(gate, answer("never"), busy));
    await chat.root.submit({ type: "input", content: "busy" }, context);
    await busy.promise;
    chat.faux.summaries.push(summary());
    const queued = await result(chat, await chat.root.compact(undefined, context));
    await chat.root.abort(context);
    const submissionId = queued.status === "completed" ? queued.result.submissionId! : undefined;
    const submission = (await chat.harness.submission(submissionId!, context))!;
    expect((await submission.status(context)).status).toBe("queued");
    expect(await submission.abort(context)).toBe("aborted");
    await turn(chat, "next", "ok");
    expect(await submission.status(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    await chat.harness.close(context);
  });
});

describe("manual compaction", () => {
  it("is ordinary work: idle waits include it", async () => {
    const chat = await open();
    await history(chat);
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary(), reached));
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    let idle = false;
    const wait = chat.root.waitForIdle(context).then(() => {
      idle = true;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(idle).toBe(false);
    gate.resolve();
    await wait;
    expect((await chat.harness.getTask(id, context))?.state.status).toBe("terminal");
    await chat.harness.close(context);
  });

  it("enables scheduling right after open", async () => {
    const setup = chatSetup();
    const faux = script(setup);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    setup.settings.compaction = { ...MANUAL, keepRecentTokens: 10 };
    const id = await root.compact(undefined, context);
    // getTask() only reads, so progress here comes from compact() itself.
    await waitFor(async () => (await harness.getTask(id, context))?.state.status === "terminal");
    expect((await harness.getTask(id, context))?.state).toMatchObject({
      outcome: { status: "completed", result: {} },
    });
    expect(faux.summaryRequests).toHaveLength(0);
    await harness.close(context);
  });
});

describe("compaction outcomes", () => {
  it("completes without a summary when there is nothing to compact", async () => {
    const chat = await open();
    await turn(chat, "hi", "hello");
    const outcome = await result(chat, await chat.root.compact(undefined, context));
    expect(outcome).toEqual({ status: "completed", result: {} });
    expect(chat.faux.summaryRequests).toHaveLength(0);
    expect((await live(chat)).compactions).toBeUndefined();
    await chat.harness.close(context);
  });
});

describe("compaction outcomes", () => {
  it("asks beforeCompact: the first decision wins, a throw is reported and skipped", async () => {
    const chat = await open();
    const seen: unknown[] = [];
    addHooks(chat.setup.registry, CompactionTask, {
      beforeCompact: () => {
        throw new Error("hook broke");
      },
    });
    addHooks(chat.setup.registry, CompactionTask, {
      beforeCompact: (compaction) => {
        seen.push(compaction);
        return { summary: "FROM HOOK" };
      },
    });
    addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) });
    await history(chat);
    const outcome = await result(chat, await chat.root.compact("why", context));
    expect(outcome.status).toBe("completed");
    expect(chat.faux.summaryRequests).toHaveLength(0);
    expect(firstUserText((await chat.root.context(context)).messages)).toContain(
      "<summary>\nFROM HOOK\n</summary>",
    );
    expect(chat.setup.reports).toEqual([expect.objectContaining({ message: "hook broke" })]);
    const compaction = seen[0] as {
      entries: EntryRecord[];
      messages: Message[];
      firstKept: number;
    };
    expect(compaction).toMatchObject({ reason: "manual", instructions: "why" });
    expect(compaction.entries.map((record) => record.kind)).toEqual([
      "msa.user",
      "msa.system",
      "msa.assistant",
      "msa.user",
      "msa.assistant",
    ]);
    expect(
      compaction.messages.filter((message) => message.role !== "system").map(userText),
    ).toEqual([text("u1", 100), text("a1", 100), text("u2", 100), text("a2", 100)]);
    await chat.harness.close(context);
  });
});
