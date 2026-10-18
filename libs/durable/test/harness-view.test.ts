import {
  type AssistantMessage,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
} from "@msa/ai";
import { type Conversation, type Harness, LiveDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { committed, replay, type Frame, drained, record, fresh } from "./harness-view-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

const MOUNTED = ["msa.agent", "msa.inbox", "msa.live", "msa.provider", "msa.usage"];

function answer(text: string): AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

function touches(harness: Harness, conversation: Conversation): { count: number } {
  const counter = { count: 0 };
  harness.subscribeCommits((publication) => {
    const touched = publication.changes.some(
      (change) =>
        (change.type === "entry" && change.value.conversationId === conversation.id) ||
        (change.type === "document" &&
          change.conversationId === conversation.id &&
          MOUNTED.includes(change.record.kind) &&
          change.ops.length > 0),
    );
    if (touched) counter.count++;
  });
  return counter;
}

const hydratesActiveEntries = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([answer("hello")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  const view = yield* fresh(root);
  expect(view.conversation).toEqual({ id: root.id });
  expect(view.entries).toEqual(yield* allEntries(root));
  expect(Object.keys(view.docs).sort()).toEqual(MOUNTED);
  expect(view.docs["msa.live"]).toEqual({});
  expect(view.docs["msa.inbox"]).toEqual({ items: [] });
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("hydrates the active entries and the built-in documents", () =>
    Effect.runPromise(hydratesActiveEntries));
});

const publishesOneFrame = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const release = deferred();
  const step: FauxResponseStep = (_request, options) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(Promise.race([release.promise, aborted(options!.signal!)]));
        return answer("a longer answer");
      }),
    );
  setup.faux.setResponses([step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { initial, frames, stop } = yield* awaited(record(root));
  const touching = touches(harness, root);
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  yield* waitFor(() =>
    frames.some((frame) => (frame.value.docs["msa.live"] as { generation?: unknown }).generation),
  );
  release.resolve();
  yield* awaited(submission.wait(context));
  yield* awaited(harness.waitForIdle(context));
  yield* drained();
  expect(frames).toHaveLength(touching.count);
  expect(replay(initial, frames)).toEqual(yield* committed(harness, root, initial.conversation));
  expect(frames[0]!.ops).toContainEqual([
    "p",
    ["entries"],
    0,
    0,
    [expect.objectContaining({ kind: "msa.user" })],
  ]);
  expect(frames.flatMap((frame) => frame.ops)).toContainEqual([
    "s",
    ["docs", "msa.live", "generation"],
    { attempt: 1 },
  ]);
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("publishes one frame per touching commit, whose operations rebuild every revision", () =>
    Effect.runPromise(publishesOneFrame));
});

const sharesUnchangedParts = Effect.gen(function* () {
  const setup = chatSetup();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const other = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const { initial, frames, stop } = yield* awaited(record(root));
  yield* awaited(other.commit((tx) => tx.appendEntry(other.id, { kind: "note" }), context));
  yield* awaited(root.configure({ thinkingLevel: "high" }, context));
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  yield* drained();
  expect(frames).toHaveLength(2);
  expect(frames[0]!.ops).toEqual([["s", ["docs", "msa.agent", "thinkingLevel"], "high"]]);
  expect(frames[0]!.value.entries).toBe(initial.entries);
  expect(frames[0]!.value.docs["msa.live"]).toBe(initial.docs["msa.live"]);
  expect(frames[1]!.value.docs).toBe(frames[0]!.value.docs);
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

const cutsEntriesHead = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const note = (kind: string) => root.commit((tx) => tx.appendEntry(root.id, { kind }), context);
  yield* awaited(note("a"));
  const b = yield* awaited(note("b"));
  yield* awaited(note("c"));
  const { initial, frames, stop } = yield* awaited(record(root));
  const summary = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "summary", head: b.id }), context),
  );
  yield* awaited(note("d"));
  yield* awaited(root.reset(undefined, context));
  yield* drained();
  const kinds = frames.map((frame) => frame.value.entries.map((entry) => entry.kind));
  expect(kinds).toEqual([["summary", "b", "c"], ["summary", "b", "c", "d"], ["msa.reset"]]);
  expect(frames[0]!.ops).toEqual([["p", ["entries"], 0, 1, [summary]]]);
  expect(replay(initial, frames)).toEqual(yield* committed(harness, root, initial.conversation));
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("shares unchanged parts between revisions and skips commits that touch nothing mounted", () =>
    Effect.runPromise(sharesUnchangedParts));

  it("cuts the entries at a head marker, keeping the entries from its head", () =>
    Effect.runPromise(cutsEntriesHead));
});

const keepsOnlyMounted = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const old = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "old" }), context),
  );
  yield* awaited(root.reset(undefined, context));
  const { frames, stop } = yield* awaited(record(root));
  yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "summary", head: old.id }), context),
  );
  yield* drained();
  expect(frames[0]!.value.entries.map((entry) => entry.kind)).toEqual(["summary"]);
  yield* awaited(stop());
  expect((yield* fresh(root)).entries.map((entry) => entry.kind)).toEqual(["summary", "old"]);
  yield* awaited(harness.close(context));
});

const cutsForkView = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const a = yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "a" }), context));
  const b = yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "b" }), context));
  const fork = yield* awaited(root.fork(b.id, { ownership: { kind: "ownerless" } }, context));
  const { initial, frames, stop } = yield* awaited(record(fork));
  yield* awaited(
    fork.commit((tx) => tx.appendEntry(fork.id, { kind: "summary", head: b.id }), context),
  );
  yield* drained();
  expect(initial.entries.map((entry) => entry.id)).toEqual([a.id, b.id]);
  expect(frames[0]!.value.entries.map((entry) => entry.kind)).toEqual(["summary", "b"]);
  expect(frames[0]!.value).toEqual(yield* committed(harness, fork, initial.conversation));
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

const showsForkInherited = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const first = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "first" }), context),
  );
  const fork = yield* awaited(root.fork(first.id, { ownership: { kind: "ownerless" } }, context));
  const { initial, frames, stop } = yield* awaited(record(fork));
  expect(initial.entries.map((entry) => entry.kind)).toEqual(["first"]);
  expect(initial.conversation.parent).toEqual({ conversationId: root.id, at: first.id });
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "parent" }), context));
  yield* awaited(fork.commit((tx) => tx.appendEntry(fork.id, { kind: "child" }), context));
  yield* drained();
  expect(frames.map((frame) => frame.value.entries.map((entry) => entry.kind))).toEqual([
    ["first", "child"],
  ]);
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("keeps only mounted entries for a raw head write that targets before the active range", () =>
    Effect.runPromise(keepsOnlyMounted));

  it("cuts a fork's view into its inherited entries", () => Effect.runPromise(cutsForkView));

  it("shows a fork's inherited entries and follows only the fork's own commits", () =>
    Effect.runPromise(showsForkInherited));
});

const unmountsRetiredDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const { frames, stop } = yield* awaited(record(root));
  yield* awaited(root.commit((tx) => tx.retireDoc(LiveDoc, root.id), context));
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, root.id))).tools = [];
          }),
        ),
      context,
    ),
  );
  yield* drained();
  expect(frames.map((frame) => frame.ops)).toEqual([
    [["d", ["docs", "msa.live"]]],
    [["s", ["docs", "msa.live"], { tools: [] }]],
  ]);
  expect(frames[0]!.value.docs["msa.live"]).toBeUndefined();
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

const replacesUndeliveredFrames = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const watch = yield* awaited(root.watch(context));
  for (const _ of Array.from({ length: 101 })) {
    yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  }
  const frames: Frame[] = [];
  watch.start((value, ops) => {
    frames.push({ value, ops });

    return Promise.resolve();
  });
  yield* drained();
  expect(frames).toHaveLength(1);
  expect(frames[0]!.ops).toEqual([["r", frames[0]!.value]]);
  expect(frames[0]!.value.entries).toHaveLength(101);
  yield* awaited(watch.stop());
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("unmounts a retired document and mounts its recreation whole", () =>
    Effect.runPromise(unmountsRetiredDocument));

  it("replaces undelivered frames with the newest view after 100 pending frames", () =>
    Effect.runPromise(replacesUndeliveredFrames));
});

const keepsStatesWatches = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const state = yield* awaited(root.viewState(context));
  const { frames, stop } = yield* awaited(record(root));
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "one" }), context));
  yield* drained();
  expect(state.value.entries.map((entry) => entry.kind)).toEqual(["one"]);
  yield* awaited(stop());
  expect(frames).toHaveLength(1);
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "two" }), context));
  yield* drained();
  expect(state.value.entries.map((entry) => entry.kind)).toEqual(["one", "two"]);
  const last = state.value;
  state.dispose();
  const rebuilt = yield* fresh(root);
  expect(rebuilt).toEqual(last);
  expect(rebuilt).not.toBe(last);
  yield* awaited(harness.close(context));
});

const endsStatesWatches = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const watch = yield* awaited(root.watch(context));
  const state = yield* awaited(root.viewState(context));
  yield* awaited(harness.close(context));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
  expect(state.value.entries).toEqual([]);
  yield* awaited(expect(root.watch(context)).rejects.toThrow());
  yield* awaited(expect(root.viewState(context)).rejects.toThrow());
});

describe("conversation view", () => {
  it("keeps states and watches of one conversation independent and remounts after the last one detaches", () =>
    Effect.runPromise(keepsStatesWatches));

  it("ends states and watches at close and rejects later acquisition", () =>
    Effect.runPromise(endsStatesWatches));
});
