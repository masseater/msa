import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxToolCall, type Message, Type } from "@msa/ai";
import { type CompactionResult, defineTool, type TaskId } from "@msa/durable";
import { CompactionTask } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, toolsNamed } from "./chat-support.ts";
import {
  compactionTasks,
  type Chat,
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
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
  ENABLED,
} from "./harness-compaction-support.ts";
import { addHooks, addSection, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { type Deferred, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// A tool that signals `reached`, then holds its call until `gate` opens.
function slowTool(reached: Deferred<void>, gate: Deferred<void>) {
  return defineTool({
    name: "slow",
    description: "slow",
    parameters: Type.Object({}),
    execute: async () => {
      reached.resolve();
      await gate.promise;
      return { output: [{ type: "text", text: text("result", 200) }] };
    },
  });
}

describe("overflow compaction", () => {
  it("fails a second overflow with its error entry", async () => {
    const chat = await open();
    await history(chat);
    chat.setup.settings.compaction = ENABLED;
    chat.faux.summaries.push(summary());
    chat.faux.agent.push(failure(OVERFLOW), failure(OVERFLOW));
    const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: OVERFLOW,
    });
    expect((await kinds(chat.root)).filter((kind) => kind === "msa.compaction")).toHaveLength(1);
    expect((await kinds(chat.root)).at(-1)).toBe("msa.assistant");
    await chat.harness.close(context);
  });

  it("fails without compacting when compaction is disabled, even for a retryable-looking overflow", async () => {
    const chat = await open();
    await history(chat);
    chat.faux.agent.push(failure(`overloaded: ${OVERFLOW}`));
    const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
    });
    expect(chat.faux.agentRequests).toHaveLength(4);
    expect(chat.faux.summaryRequests).toHaveLength(0);
    await chat.harness.close(context);
  });

  it("fails after a blocking threshold compaction in the same generation", async () => {
    const chat = await open({ contextWindow: 1000 });
    await history(chat);
    chat.setup.settings.compaction = BLOCKING;
    chat.faux.summaries.push(summary());
    chat.faux.agent.push(failure(OVERFLOW));
    const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
    });
    expect(chat.faux.summaryRequests).toHaveLength(1);
    await chat.harness.close(context);
  });
});

describe("overflow compaction", () => {
  for (const [name, prepare, requests] of [
    [
      "declines",
      (chat: Chat) =>
        addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) }),
      0,
    ],
    ["fails", (chat: Chat) => chat.faux.summaries.push(failure("bad request")), 1],
    // Classification finds no cut, so no compaction starts and the ordinary failure carries the text.
    [
      "cannot cut",
      (chat: Chat) => {
        chat.setup.settings.compaction = { ...ENABLED, keepRecentTokens: 100_000 };
      },
      0,
    ],
  ] as const) {
    it(`fails with the overflow text when compaction ${name}`, async () => {
      const chat = await open();
      await turn(chat, text("u1", 100), text("a1", 100));
      chat.setup.settings.compaction = ENABLED;
      await prepare(chat);
      chat.faux.agent.push(failure(OVERFLOW));
      const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
      expect(await input.wait(context)).toMatchObject({
        status: "unanswered",
        reason: "model_error",
        detail: OVERFLOW,
      });
      expect(chat.faux.summaryRequests).toHaveLength(requests);
      await chat.harness.close(context);
    });
  }
});

describe("compaction estimates and interactions", () => {
  for (const clock of ["real", "fixed"] as const) {
    it(`ignores usage measured before a summary placed mid-run (${clock} clock)`, async () => {
      const setup = chatSetup({ models: [{ id: "faux-1", contextWindow: 2000, maxTokens: 900 }] });
      if (clock === "fixed") setup.now = () => 1_000;
      const chat = await open({ contextWindow: 2000 }, setup);
      const toolGate = deferred();
      const toolReached = deferred();
      addTool(chat.setup.registry, slowTool(toolReached, toolGate));
      await chat.root.configure({ tools: toolsNamed(chat.setup, "slow") }, context);
      await turn(chat, text("u1", 220), text("a1", 220));
      await turn(chat, text("u2", 220), text("a2", 220));
      await turn(chat, text("u3", 220), text("a3", 220));
      // Background at 900, blocking at 1500: the tool call's usage plus its result would cross 1500.
      chat.setup.settings.compaction = { ...BACKGROUND, backgroundTokens: 600 };
      // The request starts a background compaction; its tool call's usage measures the whole context.
      chat.faux.agent.push(
        fauxAssistantMessage([fauxToolCall("slow", {})], { stopReason: "toolUse" }),
      );
      chat.faux.agent.push(answer("done"));
      const summaryGate = deferred();
      const summaryReached = deferred();
      chat.faux.summaries.push(gated(summaryGate, summary(), summaryReached));
      const input = await chat.root.submit({ type: "input", content: text("u4", 50) }, context);
      await Promise.all([toolReached.promise, summaryReached.promise]);
      const [background] = await compactionTasks(chat);
      summaryGate.resolve();
      // Queued: the run is busy in its tool round.
      const queued = await result(chat, background!.id as TaskId<CompactionResult>);
      const submissionId = queued.status === "completed" ? queued.result.submissionId! : undefined;
      expect(
        (await (await chat.harness.submission(submissionId!, context))!.status(context)).status,
      ).toBe("queued");
      toolGate.resolve();
      expect((await input.wait(context)).status).toBe("done");
      // The summary landed at postTools; the successor saw a small context and did not compact again.
      expect(chat.faux.summaryRequests).toHaveLength(1);
      expect(await compactionTasks(chat)).toEqual([]);
      expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toContain("SUMMARY");
      await chat.harness.close(context);
    });
  }
});

describe("compaction estimates and interactions", () => {
  it("rebaselines the system prompt over kept system deltas", async () => {
    const chat = await open();
    let mood = "cheerful";
    addSection(chat.setup.registry, "mood", () => mood, { tag: false });
    await turn(chat, text("u1", 100), text("a1", 100));
    await turn(chat, text("u2", 100), text("a2", 100));
    mood = "terse";
    await turn(chat, text("u3", 100), text("a3", 100));
    chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: 250 };
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    // The kept range holds the delta for the terse mood; the next request has one complete baseline.
    expect(
      (await chat.root.context(context)).entries.some((record) => record.kind === "msa.system"),
    ).toBe(true);
    await turn(chat, "next", "ok");
    const systems = chat.faux.agentRequests
      .at(-1)!
      .messages.filter((message) => message.role === "system");
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ sections: { preamble: "You are helpful.", mood: "terse" } });
    await chat.harness.close(context);
  });
});

describe("compaction estimates and interactions", () => {
  it("summarizes a replaced entry's replacement and shows it to the hook", async () => {
    const chat = await open();
    await history(chat);
    const [u1] = await allEntries(chat.root);
    await chat.root.submit(
      {
        type: "write",
        entry: {
          kind: "app.redact",
          edits: [
            {
              target: u1!.id,
              action: "replace",
              messages: [{ role: "user", content: "REDACTED", timestamp: 0 }],
            },
          ],
        },
      },
      context,
    );
    let messages: readonly Message[] = [];
    addHooks(chat.setup.registry, CompactionTask, {
      beforeCompact: (compaction) => {
        messages = compaction.messages;
        return undefined;
      },
    });
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    expect(firstUserText(messages)).toBe("REDACTED");
    expect(userText(chat.faux.summaryRequests[0]!.messages[1])).toContain("[User]: REDACTED");
    await chat.harness.close(context);
  });
});

describe("compaction estimates and interactions", () => {
  it("compacts a fork whose cut falls on a parent entry", async () => {
    const chat = await open();
    await history(chat);
    const entries = await allEntries(chat.root);
    const fork = await chat.root.fork(
      entries.at(-1)!.id,
      { ownership: { kind: "ownerless" } },
      context,
    );
    chat.faux.summaries.push(summary());
    const outcome = await result(chat, await fork.compact(undefined, context));
    const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    expect(
      (await (await chat.harness.submission(submissionId!, context))!.wait(context)).status,
    ).toBe("done");
    const u3 = entries.find((record) => userText(record.model?.[0]).startsWith("u3"))!;
    const view = await fork.context(context);
    expect(view.head).toMatchObject({
      kind: "msa.compaction",
      head: u3.id,
      conversationId: fork.id,
    });
    expect(view.messages.slice(1).map(userText)).toEqual([text("u3", 100), text("a3", 100)]);
    // The parent is untouched.
    expect((await kinds(chat.root)).includes("msa.compaction")).toBe(false);
    // The fork's view keeps the parent entries the summary kept.
    const state = await fork.viewState(context);
    expect(state.value.entries).toEqual(view.entries);
    state.dispose();
    await chat.harness.close(context);
  });
});
