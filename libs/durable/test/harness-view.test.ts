import type aiTypes from "@msa/ai/index.types";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessViewCases from "./harness-view-cases.ts";
import harnessViewSupport from "./harness-view-support.ts";
import support from "./support.ts";

const { MemoryStorage } = memory;

const { MOUNTED, answer } = harnessViewCases;
const { committed, drained, fresh, record, replay } = harnessViewSupport;
const { aborted, allEntries, awaited, chatSetup, context, deferred, openChat, waitFor } = support;

function touches(
  harness: durableTypes.Harness,
  conversation: durableTypes.Conversation,
): { count: number } {
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
    (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
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
  const step: aiTypes.FauxResponseStep = (_request, options) =>
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
  const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
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
    root.commit((tx) => tx.appendEntry(root.id, { head: b.id, kind: "summary" }), context),
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
    root.commit((tx) => tx.appendEntry(root.id, { head: old.id, kind: "summary" }), context),
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
    fork.commit((tx) => tx.appendEntry(fork.id, { head: b.id, kind: "summary" }), context),
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
  expect(initial.conversation.parent).toEqual({ at: first.id, conversationId: root.id });
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
