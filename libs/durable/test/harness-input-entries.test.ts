import { type AgentEvent, ConversationBusy, LiveDoc, type SubmissionDraft } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, textOf, waitFor } from "./chat-support.ts";
import {
  inboxItems,
  mention,
  toolRunning,
  answer,
  HOLD,
  holdTool,
  gated,
  transcript,
  requestLog,
} from "./harness-input-entries-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

async function queuedBusyInputs() {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  setup.faux.setResponses([HOLD, answer("after tools"), answer("follow-up")]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const input = await root.submit({ type: "input", content: "a" }, context);
  await toolRunning(harness, root);
  const steer = await root.submit(
    { type: "input", content: "s", entry: mention("s"), whenBusy: "steer", requestId: "r-s" },
    context,
  );
  const followUp = await root.submit(
    { type: "input", content: "f", entry: { kind: "p2.input" }, whenBusy: "followUp" },
    context,
  );
  expect(await inboxItems(harness, root)).toEqual([
    {
      id: steer.id,
      mode: "steer",
      content: "s",
      entry: { kind: "chat.mention", data: { author: "ann", text: "s" } },
    },
    { id: followUp.id, mode: "followUp", content: "f", entry: { kind: "p2.input" } },
  ]);
  // The request ID deduplicates a queued input with an entry as any other.
  const again = await root.submit(
    {
      type: "input",
      content: "other",
      entry: mention("other"),
      whenBusy: "steer",
      requestId: "r-s",
    },
    context,
  );
  expect(again.id).toBe(steer.id);
  await expect(
    root.submit({ type: "input", content: "x", entry: mention("x"), whenBusy: "reject" }, context),
  ).rejects.toBeInstanceOf(ConversationBusy);
  expect(await inboxItems(harness, root)).toHaveLength(2);
  return { gate, harness, root, input, steer, followUp };
}

describe("input entries", () => {
  it("places an idle input as its entry: the given kind and data, with the content as its user message", async () => {
    const setup = chatSetup();
    setup.now = () => 42;
    const requests: string[][] = [];
    setup.faux.setResponses([requestLog(requests, answer("hi ann"))]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit(
      { type: "input", content: "ann: hi", entry: mention("hi") },
      context,
    );
    const settled = await submission.wait(context);
    const entries = await allEntries(root);
    expect(transcript(entries)).toEqual([
      ["chat.mention", { author: "ann", text: "hi" }, "ann: hi"],
      ["msa.assistant", "hi ann"],
    ]);
    const placed = entries.find((entry) => entry.kind === "chat.mention")!;
    expect(placed.model).toEqual([{ role: "user", content: "ann: hi", timestamp: 42 }]);
    expect(settled).toMatchObject({ status: "done", entry: placed.id, answer: entries.at(-1)!.id });
    expect(requests).toEqual([["user:ann: hi"]]);
    // The context of a fork at the input is the same as for a msa.user entry.
    const view = await root.context(context, { at: placed.id });
    expect(view.messages.filter((message) => message.role !== "system")).toEqual(placed.model);
    await harness.close(context);
  });

  it("rejects an input entry whose kind is not a non-empty string or starts with msa., writing nothing", async () => {
    const setup = chatSetup();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const before = (await allEntries(root)).length;
    for await (const kind of [123, "", "msa.user", "msa.compaction"]) {
      const draft = { type: "input", content: "x", entry: { kind } } as unknown as SubmissionDraft;
      await expect(root.submit(draft, context)).rejects.toThrow("An input entry's kind must be");
    }
    expect((await allEntries(root)).length).toBe(before);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    // Writes keep their kinds: reset() writes msa.reset.
    await root.reset(undefined, context);
    expect((await allEntries(root)).at(-1)?.kind).toBe("msa.reset");
    await harness.close(context);
  });
});

describe("input entries", () => {
  it("takes only kind and data from an untyped caller's entry", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([answer("idle"), first.step, answer("queued")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const extra = {
      kind: "chat.mention",
      model: [{ role: "user", content: "forged", timestamp: 0 }],
      head: "self",
      edits: [{ target: 1, action: "omit" }],
    };
    const draft = (content: string) =>
      ({ type: "input", content, entry: extra }) as unknown as SubmissionDraft;
    await (await root.submit(draft("idle"), context)).wait(context);
    await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const queued = await root.submit(draft("later"), context);
    expect((await inboxItems(harness, root)).at(-1)).toEqual({
      id: queued.id,
      mode: "followUp",
      content: "later",
      entry: { kind: "chat.mention" },
    });
    first.release();
    await queued.wait(context);
    const mentions = (await allEntries(root)).filter((entry) => entry.kind === "chat.mention");
    expect(
      mentions.map((entry) => [
        entry.head,
        entry.edits,
        textOf(entry.model?.[0]),
        entry.model?.length,
      ]),
    ).toEqual([
      [undefined, undefined, "idle", 1],
      [undefined, undefined, "later", 1],
    ]);
    await harness.close(context);
  });
});

describe("input entries", () => {
  it("queues busy inputs with their entries in the inbox and places them as those entries at boundaries", async () => {
    const { gate, harness, root, input, steer, followUp } = await queuedBusyInputs();

    gate.resolve();
    await followUp.wait(context);
    const entries = await allEntries(root);
    expect(transcript(entries)).toEqual([
      ["msa.user", "a"],
      ["msa.assistant"],
      ["msa.tool-result"],
      ["chat.mention", { author: "ann", text: "s" }, "s"],
      ["msa.assistant", "after tools"],
      ["p2.input", "f"],
      ["msa.assistant", "follow-up"],
    ]);
    const answers = entries.filter((entry) => entry.kind === "msa.assistant");
    const placed = (kind: string) => entries.find((entry) => entry.kind === kind)!.id;
    expect(await input.status(context)).toMatchObject({ status: "done", answer: answers[1]!.id });
    expect(await steer.status(context)).toMatchObject({
      status: "done",
      entry: placed("chat.mention"),
      answer: answers[1]!.id,
    });
    expect(await followUp.status(context)).toMatchObject({
      status: "done",
      entry: placed("p2.input"),
      answer: answers[2]!.id,
    });
    await harness.close(context);
  });
});

describe("input entries", () => {
  it("withdraws queued inputs with entries, one by one and by conversation abort", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const withdrawn = await root.submit(
      { type: "input", content: "w", entry: mention("w") },
      context,
    );
    const aborted = await root.submit(
      { type: "input", content: "x", entry: mention("x") },
      context,
    );
    expect(await withdrawn.abort(context)).toBe("aborted");
    expect((await inboxItems(harness, root)).map((item) => item.id)).toEqual([aborted.id]);
    await root.abort(context);
    for await (const submission of [withdrawn, aborted]) {
      expect(await submission.wait(context)).toMatchObject({
        status: "unanswered",
        reason: "aborted",
      });
    }
    expect(await input.wait(context)).toMatchObject({ status: "unanswered", reason: "aborted" });
    expect(await inboxItems(harness, root)).toEqual([]);
    expect((await allEntries(root)).some((entry) => entry.kind === "chat.mention")).toBe(false);
    await harness.close(context);
  });
});

async function watchedHeldChat() {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  const requests: string[][] = [];
  setup.faux.setResponses([requestLog(requests, HOLD), requestLog(requests, answer("done"))]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const events: AgentEvent[] = [];
  const stream = await watchEvents(harness, root.id, context);
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { gate, requests, harness, root, events, stream };
}

describe("data-only writes", () => {
  it("appends a data-only write mid-run in time order, leaving the model's messages unchanged", async () => {
    const { gate, requests, harness, root, events, stream } = await watchedHeldChat();
    const input = await root.submit({ type: "input", content: "a" }, context);
    await toolRunning(harness, root);
    const chat = { kind: "chat.message", data: { author: "bob", text: "lunch?" } };
    const write = await root.submit({ type: "write", entry: chat, requestId: "bob:1" }, context);
    // Settled and appended in its own commit, between the call and its still-running tool's result.
    const settled = await write.status(context);
    expect(settled.status).toBe("done");
    expect(await inboxItems(harness, root)).toEqual([]);
    expect(transcript(await allEntries(root))).toEqual([
      ["msa.user", "a"],
      ["msa.assistant"],
      ["chat.message", { author: "bob", text: "lunch?" }],
    ]);
    await waitFor(() => events.some((event) => event.type === "entry_appended"));
    const appended = events.find((event) => event.type === "entry_appended");
    expect(appended).toMatchObject({
      entry: { kind: "chat.message", id: settled.status === "done" && settled.entry },
    });
    expect(events.some((event) => event.type === "run_end")).toBe(false);
    // A repeated request ID returns the same write without a second entry.
    expect(
      (await root.submit({ type: "write", entry: chat, requestId: "bob:1" }, context)).id,
    ).toBe(write.id);

    gate.resolve();
    await input.wait(context);
    expect(transcript(await allEntries(root))).toEqual([
      ["msa.user", "a"],
      ["msa.assistant"],
      ["chat.message", { author: "bob", text: "lunch?" }],
      ["msa.tool-result"],
      ["msa.assistant", "done"],
    ]);
    expect(requests).toEqual([
      ["system:", "user:a"],
      ["system:", "user:a", "assistant:", "toolResult:held"],
    ]);
    await stream.stop();
    await harness.close(context);
  });
});
