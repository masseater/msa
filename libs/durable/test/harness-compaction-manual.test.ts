import ai from "@msa/ai";
import durable from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import type harnessCompactionSupportTypes from "./harness-compaction-support.types.ts";
import support from "./support.ts";

const { Type, fauxAssistantMessage, fauxToolCall } = ai;

const { ProviderDoc, UsageDoc, defineTool } = durable;

const { answer, directories, gated, history, kinds, open, result, summary, text, turn, userText } =
  harnessCompactionSupport;
const { addTool, allEntries, awaited, context, deferred, removeDir, toolsNamed } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const expectSummaryRequest = Effect.fn("expectSummaryRequest")(function* (
  chat: harnessCompactionSupportTypes.Chat,
) {
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
    sessionId: (yield* awaited(chat.harness.snapshot(ProviderDoc, chat.root.id, context)))!
      .sessionId,
  });
  expect(request.options?.deferred).toBeUndefined();
});

const expectSummarizerSpendOnce = Effect.fn("expectSummarizerSpendOnce")(function* (
  chat: harnessCompactionSupportTypes.Chat,
  usageBefore: { readonly input: number },
) {
  const usage = (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!.models[
    "faux/faux-1"
  ]!;
  expect(usage.input).toBeGreaterThan(usageBefore.input);
  yield* turn(chat, "next", "done");
  const agent = chat.faux.agentRequests.at(-1)!.messages;
  expect(agent.map((message) => message.role)).toEqual([
    "system",
    "user",
    "user",
    "assistant",
    "user",
  ]);
  expect(agent[0]).toMatchObject({ sections: { preamble: "You are helpful." } });
  yield* awaited(chat.harness.close(context));
});

const placesSummaryOnce = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const before = yield* allEntries(chat.root);
  const usageBefore = (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!
    .models["faux/faux-1"]!;
  chat.faux.summaries.push(summary());
  const id = yield* awaited(chat.root.compact("focus on files", context));
  const outcome = yield* awaited(result(chat, id));
  expect(outcome.status).toBe("completed");
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId : undefined;
  const placed = yield* awaited(
    (yield* awaited(chat.harness.submission(submissionId!, context)))!.wait(context),
  );
  expect(placed.status).toBe("done");
  const after = yield* allEntries(chat.root);
  expect(after.slice(0, before.length)).toEqual(before);
  const marker = after.at(-1)!;
  const u3 = before.find((record) => userText(record.model?.[0]).startsWith("u3"))!;
  expect(marker).toMatchObject({
    data: { reason: "manual" },
    head: u3.id,
    kind: "msa.compaction",
  });
  expect(placed.status === "done" && placed.entry).toBe(marker.id);
  expect(userText(marker.model?.[0])).toBe(
    "The conversation history before this point was compacted into the following summary:\n\n<summary>\nSUMMARY\n</summary>",
  );
  const view = yield* awaited(chat.root.context(context));
  expect(view.messages.map(userText)).toEqual([
    userText(marker.model?.[0]),
    text("u3", 100),
    text("a3", 100),
  ]);
  yield* expectSummaryRequest(chat);
  yield* expectSummarizerSpendOnce(chat, usageBefore);
});

describe("manual compaction", () => {
  it("places the summary at once when idle and keeps raw history", () =>
    Effect.runPromise(placesSummaryOnce));
});

const createsProviderState = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  yield* awaited(chat.root.commit((tx) => tx.retireDoc(ProviderDoc, chat.root.id), context));
  expect(yield* awaited(chat.harness.snapshot(ProviderDoc, chat.root.id, context))).toBeUndefined();
  chat.faux.summaries.push(summary());
  expect(
    (yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))))).status,
  ).toBe("completed");
  const stored = yield* awaited(chat.harness.snapshot(ProviderDoc, chat.root.id, context));
  expect(stored?.sessionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(chat.faux.summaryRequests[0]!.options?.sessionId).toBe(stored?.sessionId);
  yield* awaited(chat.harness.close(context));
});

const keepsWorkingBusy = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const gate = deferred();
  const reached = deferred();
  chat.faux.agent.push(gated(gate, answer("late answer"), reached));
  const input = yield* awaited(chat.root.submit({ content: "busy", type: "input" }, context));
  yield* awaited(reached.promise);
  chat.faux.summaries.push(summary());
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    (yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.status(context),
    )).status,
  ).toBe("queued");
  gate.resolve();
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  const placed = yield* awaited(
    (yield* awaited(chat.harness.submission(submissionId!, context)))!.wait(context),
  );
  expect(placed.status).toBe("done");
  expect((yield* kinds(chat.root)).slice(-3)).toEqual([
    "msa.user",
    "msa.assistant",
    "msa.compaction",
  ]);
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("creates provider state before a legacy conversation's summarization request", () =>
    Effect.runPromise(createsProviderState));

  it("keeps working while busy and places the summary at the next final boundary", () =>
    Effect.runPromise(keepsWorkingBusy));
});

const placesQueuedSummary = Effect.gen(function* () {
  const chat = yield* open();
  addTool(
    chat.setup.registry,
    defineTool({
      description: "wait",
      execute: () => Promise.resolve({ output: [{ text: "waited", type: "text" }] }),
      name: "wait",
      parameters: Type.Object({}),
    }),
  );
  yield* awaited(chat.root.configure({ tools: toolsNamed(chat.setup, "wait") }, context));
  yield* history(chat);
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
  const input = yield* awaited(chat.root.submit({ content: "use a tool", type: "input" }, context));
  yield* awaited(reached.promise);
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  gate.resolve();
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  const continuation = chat.faux.agentRequests.at(-1)!.messages;
  expect(continuation[0]?.role).toBe("system");
  expect(userText(continuation[1])).toContain("<summary>\nSUMMARY\n</summary>");
  expect((yield* kinds(chat.root)).slice(-4)).toEqual([
    "msa.tool-result",
    "msa.compaction",
    "msa.system",
    "msa.assistant",
  ]);
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("places a queued summary at postTools and the run continues in the compacted context", () =>
    Effect.runPromise(placesQueuedSummary));
});
