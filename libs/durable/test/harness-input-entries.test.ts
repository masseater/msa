import { type AgentEvent, ConversationBusy, LiveDoc, type SubmissionDraft } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, textOf, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
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

const queuedBusyInputs = Effect.fn("queuedBusyInputs")(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  setup.faux.setResponses([HOLD, answer("after tools"), answer("follow-up")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* toolRunning(harness, root);
  const steer = yield* awaited(
    root.submit(
      { type: "input", content: "s", entry: mention("s"), whenBusy: "steer", requestId: "r-s" },
      context,
    ),
  );
  const followUp = yield* awaited(
    root.submit(
      { type: "input", content: "f", entry: { kind: "p2.input" }, whenBusy: "followUp" },
      context,
    ),
  );
  expect(yield* inboxItems(harness, root)).toEqual([
    {
      id: steer.id,
      mode: "steer",
      content: "s",
      entry: { kind: "chat.mention", data: { author: "ann", text: "s" } },
    },
    { id: followUp.id, mode: "followUp", content: "f", entry: { kind: "p2.input" } },
  ]);
  const again = yield* awaited(
    root.submit(
      {
        type: "input",
        content: "other",
        entry: mention("other"),
        whenBusy: "steer",
        requestId: "r-s",
      },
      context,
    ),
  );
  expect(again.id).toBe(steer.id);
  yield* awaited(
    expect(
      root.submit(
        { type: "input", content: "x", entry: mention("x"), whenBusy: "reject" },
        context,
      ),
    ).rejects.toBeInstanceOf(ConversationBusy),
  );
  expect(yield* inboxItems(harness, root)).toHaveLength(2);
  return { gate, harness, root, input, steer, followUp };
});

const placesIdleInput = Effect.gen(function* () {
  const setup = chatSetup();
  setup.now = () => 42;
  const requests: string[][] = [];
  setup.faux.setResponses([requestLog(requests, answer("hi ann"))]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(
    root.submit({ type: "input", content: "ann: hi", entry: mention("hi") }, context),
  );
  const settled = yield* awaited(submission.wait(context));
  const entries = yield* allEntries(root);
  expect(transcript(entries)).toEqual([
    ["chat.mention", { author: "ann", text: "hi" }, "ann: hi"],
    ["msa.assistant", "hi ann"],
  ]);
  const placed = entries.find((entry) => entry.kind === "chat.mention")!;
  expect(placed.model).toEqual([{ role: "user", content: "ann: hi", timestamp: 42 }]);
  expect(settled).toMatchObject({
    status: "done",
    entry: placed.id,
    answer: entries.at(-1)!.id,
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
      type: "input",
      content: "x",
      entry: { kind },
    } as unknown as SubmissionDraft;
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
    kind: "chat.mention",
    model: [{ role: "user", content: "forged", timestamp: 0 }],
    head: "self",
    edits: [{ target: 1, action: "omit" }],
  };
  const draft = (content: string) =>
    ({ type: "input", content, entry: extra }) as unknown as SubmissionDraft;
  yield* awaited((yield* awaited(root.submit(draft("idle"), context))).wait(context));
  yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const queued = yield* awaited(root.submit(draft("later"), context));
  expect((yield* inboxItems(harness, root)).at(-1)).toEqual({
    id: queued.id,
    mode: "followUp",
    content: "later",
    entry: { kind: "chat.mention" },
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
    status: "done",
    answer: answers[1]!.id,
  });
  expect(yield* awaited(steer.status(context))).toMatchObject({
    status: "done",
    entry: placed("chat.mention"),
    answer: answers[1]!.id,
  });
  expect(yield* awaited(followUp.status(context))).toMatchObject({
    status: "done",
    entry: placed("p2.input"),
    answer: answers[2]!.id,
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
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const withdrawn = yield* awaited(
    root.submit({ type: "input", content: "w", entry: mention("w") }, context),
  );
  const aborted = yield* awaited(
    root.submit({ type: "input", content: "x", entry: mention("x") }, context),
  );
  expect(yield* awaited(withdrawn.abort(context))).toBe("aborted");
  expect((yield* inboxItems(harness, root)).map((item) => item.id)).toEqual([aborted.id]);
  yield* awaited(root.abort(context));
  for (const submission of [withdrawn, aborted]) {
    expect(yield* awaited(submission.wait(context))).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
  }
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect(yield* inboxItems(harness, root)).toEqual([]);
  expect((yield* allEntries(root)).some((entry) => entry.kind === "chat.mention")).toBe(false);
  yield* awaited(harness.close(context));
});

describe("input entries", () => {
  it("withdraws queued inputs with entries, one by one and by conversation abort", () =>
    Effect.runPromise(withdrawsQueuedInputs));
});

const watchedHeldChat = Effect.fn("watchedHeldChat")(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  const requests: string[][] = [];
  setup.faux.setResponses([requestLog(requests, HOLD), requestLog(requests, answer("done"))]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const events: AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { gate, requests, harness, root, events, stream };
});

const appendsDataOnly = Effect.gen(function* () {
  const { gate, requests, harness, root, events, stream } = yield* watchedHeldChat();
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* toolRunning(harness, root);
  const chat = { kind: "chat.message", data: { author: "bob", text: "lunch?" } };
  const write = yield* awaited(
    root.submit({ type: "write", entry: chat, requestId: "bob:1" }, context),
  );
  const settled = yield* awaited(write.status(context));
  expect(settled.status).toBe("done");
  expect(yield* inboxItems(harness, root)).toEqual([]);
  expect(transcript(yield* allEntries(root))).toEqual([
    ["msa.user", "a"],
    ["msa.assistant"],
    ["chat.message", { author: "bob", text: "lunch?" }],
  ]);
  yield* waitFor(() => events.some((event) => event.type === "entry_appended"));
  const appended = events.find((event) => event.type === "entry_appended");
  expect(appended).toMatchObject({
    entry: { kind: "chat.message", id: settled.status === "done" && settled.entry },
  });
  expect(events.some((event) => event.type === "run_end")).toBe(false);
  expect(
    (yield* awaited(root.submit({ type: "write", entry: chat, requestId: "bob:1" }, context))).id,
  ).toBe(write.id);

  gate.resolve();
  yield* awaited(input.wait(context));
  expect(transcript(yield* allEntries(root))).toEqual([
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
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("data-only writes", () => {
  it("appends a data-only write mid-run in time order, leaving the model's messages unchanged", () =>
    Effect.runPromise(appendsDataOnly));
});
