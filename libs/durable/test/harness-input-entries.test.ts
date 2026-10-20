import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessInputEntriesSupport from "./harness-input-entries-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { MemoryStorage } = memory;
const { ConversationBusy, LiveDoc } = durable;

const { allEntries, chatSetup, openChat, textOf } = chatSupport;
const { awaited } = effectSupport;
const { HOLD, answer, gated, holdTool, inboxItems, mention, requestLog, toolRunning, transcript } =
  harnessInputEntriesSupport;
const { context } = sessionSupport;
const { deferred } = taskSupport;

const queuedBusyInputsStep1 = Effect.fn("queuedBusyInputsStep1")(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  setup.faux.setResponses([HOLD, answer("after tools"), answer("follow-up")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* toolRunning(harness, root);
  const steer = yield* awaited(
    root.submit(
      { content: "s", entry: mention("s"), requestId: "r-s", type: "input", whenBusy: "steer" },
      context,
    ),
  );
  const followUp = yield* awaited(
    root.submit(
      { content: "f", entry: { kind: "p2.input" }, type: "input", whenBusy: "followUp" },
      context,
    ),
  );
  expect(yield* inboxItems(harness, root)).toEqual([
    {
      content: "s",
      entry: { data: { author: "ann", text: "s" }, kind: "chat.mention" },
      id: steer.id,
      mode: "steer",
    },
    { content: "f", entry: { kind: "p2.input" }, id: followUp.id, mode: "followUp" },
  ]);
  const again = yield* awaited(
    root.submit(
      {
        content: "other",
        entry: mention("other"),
        requestId: "r-s",
        type: "input",
        whenBusy: "steer",
      },
      context,
    ),
  );
  expect(again.id).toBe(steer.id);
  return { followUp, gate, harness, input, root, steer };
});

const queuedBusyInputs = Effect.fn("queuedBusyInputs")(function* () {
  const { gate, harness, root, input, steer, followUp } = yield* queuedBusyInputsStep1();
  yield* awaited(
    expect(
      root.submit(
        { content: "x", entry: mention("x"), type: "input", whenBusy: "reject" },
        context,
      ),
    ).rejects.toBeInstanceOf(ConversationBusy),
  );
  expect(yield* inboxItems(harness, root)).toHaveLength(2);
  return { followUp, gate, harness, input, root, steer };
});

const placesIdleInput = Effect.gen(function* () {
  const setup = chatSetup();
  setup.now = () => 42;
  const requests: string[][] = [];
  setup.faux.setResponses([requestLog(requests, answer("hi ann"))]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(
    root.submit({ content: "ann: hi", entry: mention("hi"), type: "input" }, context),
  );
  const settled = yield* awaited(submission.wait(context));
  const entries = yield* allEntries(root);
  expect(transcript(entries)).toEqual([
    ["chat.mention", { author: "ann", text: "hi" }, "ann: hi"],
    ["msa.assistant", "hi ann"],
  ]);
  const placed = entries.find((entry) => entry.kind === "chat.mention")!;
  expect(placed.model).toEqual([{ content: "ann: hi", role: "user", timestamp: 42 }]);
  expect(settled).toMatchObject({
    answer: entries.at(-1)!.id,
    entry: placed.id,
    status: "done",
  });
  expect(requests).toEqual([["user:ann: hi"]]);
  const view = yield* awaited(root.context(context, { at: placed.id }));
  expect(view.messages.filter((message) => message.role !== "system")).toEqual(placed.model);
  yield* awaited(harness.close(context));
});

const rejectsInputEntry = Effect.gen(function* () {
  const setup = chatSetup();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const before = (yield* allEntries(root)).length;
  for (const kind of [123, "", "msa.user", "msa.compaction"]) {
    const draft = {
      content: "x",
      entry: { kind },
      type: "input",
    } as unknown as durableTypes.SubmissionDraft;
    yield* awaited(
      expect(root.submit(draft, context)).rejects.toThrow("An input entry's kind must be"),
    );
  }
  expect((yield* allEntries(root)).length).toBe(before);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(root.reset(undefined, context));
  expect((yield* allEntries(root)).at(-1)?.kind).toBe("msa.reset");
  yield* awaited(harness.close(context));
});

describe("input entries", () => {
  it("places an idle input as its entry: the given kind and data, with the content as its user message", () =>
    Effect.runPromise(placesIdleInput));

  it("rejects an input entry whose kind is not a non-empty string or starts with msa., writing nothing", () =>
    Effect.runPromise(rejectsInputEntry));
});

const takesOnlyKind = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([answer("idle"), first.step, answer("queued")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const extra = {
    edits: [{ action: "omit", target: 1 }],
    head: "self",
    kind: "chat.mention",
    model: [{ content: "forged", role: "user", timestamp: 0 }],
  };
  const draft = (content: string) =>
    ({ content, entry: extra, type: "input" }) as unknown as durableTypes.SubmissionDraft;
  yield* awaited((yield* awaited(root.submit(draft("idle"), context))).wait(context));
  yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const queued = yield* awaited(root.submit(draft("later"), context));
  expect((yield* inboxItems(harness, root)).at(-1)).toEqual({
    content: "later",
    entry: { kind: "chat.mention" },
    id: queued.id,
    mode: "followUp",
  });
  first.release();
  yield* awaited(queued.wait(context));
  const mentions = (yield* allEntries(root)).filter((entry) => entry.kind === "chat.mention");
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
  yield* awaited(harness.close(context));
});

describe("input entries", () => {
  it("takes only kind and data from an untyped caller's entry", () =>
    Effect.runPromise(takesOnlyKind));
});

const queuesBusyInputs = Effect.gen(function* () {
  const { gate, harness, root, input, steer, followUp } = yield* queuedBusyInputs();

  gate.resolve();
  yield* awaited(followUp.wait(context));
  const entries = yield* allEntries(root);
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
  expect(yield* awaited(input.status(context))).toMatchObject({
    answer: answers[1]!.id,
    status: "done",
  });
  expect(yield* awaited(steer.status(context))).toMatchObject({
    answer: answers[1]!.id,
    entry: placed("chat.mention"),
    status: "done",
  });
  expect(yield* awaited(followUp.status(context))).toMatchObject({
    answer: answers[2]!.id,
    entry: placed("p2.input"),
    status: "done",
  });
  yield* awaited(harness.close(context));
});

describe("input entries", () => {
  it("queues busy inputs with their entries in the inbox and places them as those entries at boundaries", () =>
    Effect.runPromise(queuesBusyInputs));
});

const withdrawsQueuedInputs = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const withdrawn = yield* awaited(
    root.submit({ content: "w", entry: mention("w"), type: "input" }, context),
  );
  const aborted = yield* awaited(
    root.submit({ content: "x", entry: mention("x"), type: "input" }, context),
  );
  expect(yield* awaited(withdrawn.abort(context))).toBe("aborted");
  expect((yield* inboxItems(harness, root)).map((item) => item.id)).toEqual([aborted.id]);
  yield* awaited(root.abort(context));
  for (const submission of [withdrawn, aborted]) {
    expect(yield* awaited(submission.wait(context))).toMatchObject({
      reason: "aborted",
      status: "unanswered",
    });
  }
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  expect(yield* inboxItems(harness, root)).toEqual([]);
  expect((yield* allEntries(root)).some((entry) => entry.kind === "chat.mention")).toBe(false);
  yield* awaited(harness.close(context));
});

describe("input entries", () => {
  it("withdraws queued inputs with entries, one by one and by conversation abort", () =>
    Effect.runPromise(withdrawsQueuedInputs));
});
