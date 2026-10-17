import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxToolCall, Type } from "@msa/ai";
import { defineTool, ProviderDoc, UsageDoc } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, toolsNamed } from "./chat-support.ts";
import {
  type Chat,
  text,
  summary,
  answer,
  gated,
  history,
  turn,
  directories,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function expectSummaryRequest(chat: Chat) {
  // The summarizer saw the serialized prefix, the prompt, and the instructions, without tools or caching.
  const request = chat.faux.summaryRequests[0]!;
  expect(request.messages).toHaveLength(2);
  const prompt = userText(request.messages[1]);
  expect(prompt).toMatch(/^<conversation>\n\[User\]: u1 /u);
  expect(prompt).toContain("[Assistant]: a2 ");
  expect(prompt).not.toContain("u3 ");
  expect(prompt).toContain("## Goal");
  expect(prompt.endsWith("\n\nAdditional focus: focus on files")).toBe(true);
  expect(request.options).toMatchObject({
    cacheRetention: "none",
    maxTokens: 800,
    sessionId: (await chat.harness.snapshot(ProviderDoc, chat.root.id, context))!.sessionId,
  });
  expect(request.options?.deferred).toBeUndefined();
}

async function expectSummarizerSpendOnce(chat: Chat, usageBefore: { readonly input: number }) {
  // The summarizer's spend is in the ledger, and nothing counts it again later.
  const usage = (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models[
    "faux/faux-1"
  ]!;
  expect(usage.input).toBeGreaterThan(usageBefore.input);
  await turn(chat, "next", "done");
  const agent = chat.faux.agentRequests.at(-1)!.messages;
  // The next request: one complete system baseline leading the summary, the kept turn, and the new input (#10904).
  expect(agent.map((message) => message.role)).toEqual([
    "system",
    "user",
    "user",
    "assistant",
    "user",
  ]);
  expect(agent[0]).toMatchObject({ sections: { preamble: "You are helpful." } });
  await chat.harness.close(context);
}

describe("manual compaction", () => {
  it("places the summary at once when idle and keeps raw history", async () => {
    const chat = await open();
    await history(chat);
    const before = await allEntries(chat.root);
    const usageBefore = (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models[
      "faux/faux-1"
    ]!;
    chat.faux.summaries.push(summary());
    const id = await chat.root.compact("focus on files", context);
    const outcome = await result(chat, id);
    expect(outcome.status).toBe("completed");
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId : undefined;
    const placed = await (await chat.harness.submission(submissionId!, context))!.wait(context);
    expect(placed.status).toBe("done");
    // Raw history is unchanged; one summary entry heads the first kept entry, u3.
    const after = await allEntries(chat.root);
    expect(after.slice(0, before.length)).toEqual(before);
    const marker = after.at(-1)!;
    const u3 = before.find((record) => userText(record.model?.[0]).startsWith("u3"))!;
    expect(marker).toMatchObject({
      kind: "msa.compaction",
      head: u3.id,
      data: { reason: "manual" },
    });
    expect(placed.status === "done" && placed.entry).toBe(marker.id);
    expect(userText(marker.model?.[0])).toBe(
      "The conversation history before this point was compacted into the following summary:\n\n<summary>\nSUMMARY\n</summary>",
    );
    // The model context is the summary followed by the kept entries.
    const view = await chat.root.context(context);
    expect(view.messages.map(userText)).toEqual([
      userText(marker.model?.[0]),
      text("u3", 100),
      text("a3", 100),
    ]);
    await expectSummaryRequest(chat);
    await expectSummarizerSpendOnce(chat, usageBefore);
  });
});

describe("manual compaction", () => {
  // Regression coverage for #10424.
  it("creates provider state before a legacy conversation's summarization request", async () => {
    const chat = await open();
    await history(chat);
    await chat.root.commit((tx) => tx.retireDoc(ProviderDoc, chat.root.id), context);
    expect(await chat.harness.snapshot(ProviderDoc, chat.root.id, context)).toBeUndefined();
    chat.faux.summaries.push(summary());
    expect((await result(chat, await chat.root.compact(undefined, context))).status).toBe(
      "completed",
    );
    const stored = await chat.harness.snapshot(ProviderDoc, chat.root.id, context);
    expect(stored?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(chat.faux.summaryRequests[0]!.options?.sessionId).toBe(stored?.sessionId);
    await chat.harness.close(context);
  });

  it("keeps working while busy and places the summary at the next final boundary", async () => {
    const chat = await open();
    await history(chat);
    const gate = deferred();
    const reached = deferred();
    chat.faux.agent.push(gated(gate, answer("late answer"), reached));
    const input = await chat.root.submit({ type: "input", content: "busy" }, context);
    await reached.promise;
    chat.faux.summaries.push(summary());
    const outcome = await result(chat, await chat.root.compact(undefined, context));
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    expect(
      (await (await chat.harness.submission(submissionId!, context))!.status(context)).status,
    ).toBe("queued");
    gate.resolve();
    expect((await input.wait(context)).status).toBe("done");
    const placed = await (await chat.harness.submission(submissionId!, context))!.wait(context);
    expect(placed.status).toBe("done");
    // The summary follows the answer; the kept range still includes the busy turn.
    expect((await kinds(chat.root)).slice(-3)).toEqual([
      "msa.user",
      "msa.assistant",
      "msa.compaction",
    ]);
    await chat.harness.close(context);
  });
});

describe("manual compaction", () => {
  it("places a queued summary at postTools and the run continues in the compacted context", async () => {
    const chat = await open();
    addTool(
      chat.setup.registry,
      defineTool({
        name: "wait",
        description: "wait",
        parameters: Type.Object({}),
        execute: () => Promise.resolve({ output: [{ type: "text", text: "waited" }] }),
      }),
    );
    await chat.root.configure({ tools: toolsNamed(chat.setup, "wait") }, context);
    await history(chat);
    const gate = deferred();
    const reached = deferred();
    chat.faux.agent.push(
      gated(
        gate,
        fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
        reached,
      ),
    );
    chat.faux.agent.push(answer("after tools"));
    const input = await chat.root.submit({ type: "input", content: "use a tool" }, context);
    await reached.promise;
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    gate.resolve();
    expect((await input.wait(context)).status).toBe("done");
    // The continuation request starts with the new baseline, then the summary, ahead of the kept tool call (#10904).
    const continuation = chat.faux.agentRequests.at(-1)!.messages;
    expect(continuation[0]?.role).toBe("system");
    expect(userText(continuation[1])).toContain("<summary>\nSUMMARY\n</summary>");
    expect((await kinds(chat.root)).slice(-4)).toEqual([
      "msa.tool-result",
      "msa.compaction",
      "msa.system",
      "msa.assistant",
    ]);
    await chat.harness.close(context);
  });
});

describe("manual compaction", () => {
  it("runs follow-ups left by a failed run after placing the summary", async () => {
    const chat = await open();
    await history(chat);
    const gate = deferred();
    const reached = deferred();
    chat.faux.agent.push(gated(gate, failure("bad request"), reached));
    const failed = await chat.root.submit({ type: "input", content: "fails" }, context);
    await reached.promise;
    const followUp = await chat.root.submit({ type: "input", content: "follow-up" }, context);
    gate.resolve();
    expect((await failed.wait(context)).status).toBe("unanswered");
    expect((await followUp.status(context)).status).toBe("queued");

    chat.faux.summaries.push(summary());
    chat.faux.agent.push(answer("followed"));
    await result(chat, await chat.root.compact(undefined, context));
    expect((await followUp.wait(context)).status).toBe("done");
    const request = chat.faux.agentRequests.at(-1)!.messages;
    expect(firstUserText(request)).toContain("SUMMARY");
    expect(request.some((message) => userText(message) === "follow-up")).toBe(true);
    await chat.harness.close(context);
  });

  it("settles stale when a reset lands while it summarizes", async () => {
    const chat = await open();
    await history(chat);
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary(), reached));
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    await chat.root.reset(undefined, context);
    gate.resolve();
    const outcome = await result(chat, id);
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    expect(
      await (await chat.harness.submission(submissionId!, context))!.status(context),
    ).toMatchObject({
      status: "unanswered",
      reason: "stale",
    });
    expect((await kinds(chat.root)).at(-1)).toBe("msa.reset");
    await chat.harness.close(context);
  });
});

describe("manual compaction", () => {
  it("does not make the conversation busy: a submission during summarization starts its run at once", async () => {
    const chat = await open();
    await history(chat);
    const summaryGate = deferred();
    const summaryReached = deferred();
    chat.faux.summaries.push(gated(summaryGate, summary(), summaryReached));
    const id = await chat.root.compact(undefined, context);
    await summaryReached.promise;
    const answerGate = deferred();
    const answerReached = deferred();
    chat.faux.agent.push(gated(answerGate, answer("a4"), answerReached));
    const input = await chat.root.submit({ type: "input", content: "u4" }, context);
    // Placed and answered immediately with the uncompacted context, not queued behind the compaction.
    expect((await input.status(context)).status).toBe("placed");
    await answerReached.promise;
    expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toBe(text("u1", 100));
    // The summary is ready while the run is busy, so it queues and lands after the answer.
    summaryGate.resolve();
    const outcome = await result(chat, id);
    const submission = (await chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ))!;
    expect((await submission.status(context)).status).toBe("queued");
    answerGate.resolve();
    expect((await input.wait(context)).status).toBe("done");
    expect((await submission.wait(context)).status).toBe("done");
    expect((await kinds(chat.root)).slice(-3)).toEqual([
      "msa.user",
      "msa.assistant",
      "msa.compaction",
    ]);
    await chat.harness.close(context);
  });
});
