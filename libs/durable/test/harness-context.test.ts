import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessContextSupport from "./harness-context-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { setup } = harnessContextSupport;
const { assistant, describeMessage, system, toolResult, user } = harnessSupport;
const { context } = sessionSupport;

function ids(entries: readonly durableTypes.EntryRecord[]): durableTypes.EntryId[] {
  return entries.map((entry) => entry.id);
}

afterEach(() => {
  vi.useRealTimers();
});

const returnsWholeTranscript = Effect.gen(function* () {
  const { root, append, message } = yield* setup();
  const first = yield* awaited(message(user("hi")));
  const note = yield* awaited(append({ data: { text: "display only" }, kind: "note" }));
  const answer = yield* awaited(message(assistant("hello")));
  const view = yield* awaited(root.context(context));
  expect(view.head).toBeUndefined();
  expect(ids(view.entries)).toEqual([first.id, note.id, answer.id]);
  expect(view.messages.map(describeMessage)).toEqual(["user:hi", "assistant:hello"]);
});

const excludesAbortedError = Effect.gen(function* () {
  const { root, message } = yield* setup();
  yield* awaited(message(user("q")));
  const aborted = yield* awaited(message(assistant("partial", { stopReason: "aborted" })));
  yield* awaited(message(assistant("failed", { stopReason: "error" })));
  yield* awaited(message(assistant("later", { stopReason: "deferred" })));
  yield* awaited(message(assistant("done", { stopReason: "length" })));
  const view = yield* awaited(root.context(context));
  expect(view.entries).toHaveLength(5);
  expect(view.entries[1]!.id).toBe(aborted.id);
  expect(view.messages.map(describeMessage)).toEqual(["user:q", "assistant:done"]);
});

describe("conversation context", () => {
  it("returns the whole transcript without a head and excludes model-less entries from messages", () =>
    Effect.runPromise(returnsWholeTranscript));

  it("excludes aborted, error, and deferred assistant messages but keeps their raw entries", () =>
    Effect.runPromise(excludesAbortedError));
});

const resolvesSelfHeads = Effect.gen(function* () {
  const { root, append, message } = yield* setup();
  yield* awaited(message(user("old")));
  const reset = yield* awaited(
    append({ head: "self", kind: "reset", model: [user("fresh start")] }),
  );
  expect(reset.head).toBe(reset.id);
  const after = yield* awaited(message(assistant("after reset")));
  let view = yield* awaited(root.context(context));
  expect(view.head?.id).toBe(reset.id);
  expect(ids(view.entries)).toEqual([reset.id, after.id]);
  expect(view.messages.map(describeMessage)).toEqual(["user:fresh start", "assistant:after reset"]);

  const summary = yield* awaited(
    append({ head: after.id, kind: "summary", model: [user("summary")] }),
  );
  const tail = yield* awaited(message(user("next")));
  view = yield* awaited(root.context(context));
  expect(view.head?.id).toBe(summary.id);
  expect(ids(view.entries)).toEqual([summary.id, after.id, tail.id]);
  expect(view.messages.map(describeMessage)).toEqual([
    "user:summary",
    "assistant:after reset",
    "user:next",
  ]);
});

describe("conversation context", () => {
  it("resolves self heads and uses the newest head marker", () =>
    Effect.runPromise(resolvesSelfHeads));
});

const appliesNewestEdit = Effect.gen(function* () {
  const { root, append, message } = yield* setup();
  const first = yield* awaited(message(user("first")));
  const second = yield* awaited(message(user("second")));
  yield* awaited(
    append({
      edits: [{ action: "replace", messages: [user("first v2")], target: first.id }],
      kind: "edit",
    }),
  );
  yield* awaited(
    append({
      edits: [{ action: "replace", messages: [user("first v3")], target: first.id }],
      kind: "edit",
    }),
  );
  yield* awaited(append({ edits: [{ action: "omit", target: second.id }], kind: "edit" }));
  let view = yield* awaited(root.context(context));
  expect(view.entries).toHaveLength(5);
  expect(view.messages.map(describeMessage)).toEqual(["user:first v3"]);

  const reset = yield* awaited(append({ head: second.id, kind: "reset" }));
  view = yield* awaited(root.context(context));
  expect(view.head?.id).toBe(reset.id);
  expect(view.messages.map(describeMessage)).toEqual([]);
  yield* awaited(
    append({
      edits: [{ action: "replace", messages: [user("second v2")], target: second.id }],
      kind: "edit",
    }),
  );
  view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual(["user:second v2"]);
});

describe("conversation context", () => {
  it("applies the newest edit per target within the active range", () =>
    Effect.runPromise(appliesNewestEdit));
});

const keepsPositionalSystem = Effect.gen(function* () {
  const { root, message, append } = yield* setup();
  yield* awaited(message(system({ preamble: "You help." }), "msa.system"));
  yield* awaited(message(user("run tools")));
  yield* awaited(message(assistant("calling", { calls: ["b", "a"] })));
  yield* awaited(message(toolResult("a")));
  yield* awaited(append({ kind: "msa.system", model: [system({ cwd: "/repo" })] }));
  yield* awaited(message(toolResult("b")));
  yield* awaited(message(toolResult("zz")));
  yield* awaited(message(assistant("done")));
  const view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "system:preamble",
    "user:run tools",
    "assistant:calling",
    "result:b:result b",
    "result:a:result a",
    "system:cwd",
    "assistant:done",
  ]);
});

describe("conversation context", () => {
  it("keeps positional system messages and orders tool results by call order", () =>
    Effect.runPromise(keepsPositionalSystem));
});

const leadsSystemMessage = Effect.gen(function* () {
  const { root, message, append } = yield* setup();
  yield* awaited(message(user("first")));
  yield* awaited(message(user("steered")));
  yield* awaited(message(system({ preamble: "You help." }), "msa.system"));
  yield* awaited(message(assistant("answer")));
  yield* awaited(message(user("next")));
  yield* awaited(message(system({ cwd: "/repo" }), "msa.system"));
  let view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "system:preamble",
    "user:first",
    "user:steered",
    "assistant:answer",
    "user:next",
    "system:cwd",
  ]);
  expect(view.contributions.flat().map(describeMessage).slice(0, 3)).toEqual([
    "user:first",
    "user:steered",
    "system:preamble",
  ]);

  yield* awaited(append({ head: "self", kind: "reset", model: [user("handoff")] }));
  yield* awaited(message(system({ preamble: "Baseline." }), "msa.system"));
  view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual(["system:preamble", "user:handoff"]);
});

describe("conversation context", () => {
  it("leads with a system message that only user messages precede, and keeps later ones in place", () =>
    Effect.runPromise(leadsSystemMessage));
});

const leadsBaselineCompaction = Effect.gen(function* () {
  const { root, message, append } = yield* setup();
  yield* awaited(message(user("old")));
  const kept = yield* awaited(message(user("kept")));
  yield* awaited(message(assistant("calling", { calls: ["a"] })));
  yield* awaited(message(toolResult("a")));
  yield* awaited(message(assistant("answer")));
  yield* awaited(append({ head: kept.id, kind: "summary", model: [user("summary")] }));
  yield* awaited(message(user("next")));
  yield* awaited(message(system({ preamble: "Baseline." }), "msa.system"));
  let view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "system:preamble",
    "user:summary",
    "user:kept",
    "assistant:calling",
    "result:a:result a",
    "assistant:answer",
    "user:next",
  ]);

  yield* awaited(message(assistant("done")));
  yield* awaited(message(system({ cwd: "/repo" }), "msa.system"));
  view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage).slice(0, 2)).toEqual([
    "system:preamble",
    "user:summary",
  ]);
  expect(view.messages.map(describeMessage).slice(-2)).toEqual(["assistant:done", "system:cwd"]);
});

const leadsBaselineWritten = Effect.gen(function* () {
  const { root, message } = yield* setup();
  yield* awaited(message(user("first"), "msa.user"));
  yield* awaited(message(assistant("answer"), "msa.assistant"));
  yield* awaited(message(user("next"), "msa.user"));
  yield* awaited(message(system({ plan: "Plan." }), "msa.system"));
  const view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "system:plan",
    "user:first",
    "assistant:answer",
    "user:next",
  ]);
});

describe("conversation context", () => {
  it("leads with the baseline after a compaction that keeps assistant messages", () =>
    Effect.runPromise(leadsBaselineCompaction));

  it("leads with a baseline written after the first answers, when the agent had no section or tool before", () =>
    Effect.runPromise(leadsBaselineWritten));
});

const keepsSystemMessages = Effect.gen(function* () {
  const { root, message, append } = yield* setup();
  yield* awaited(message(user("first")));
  yield* awaited(message(assistant("answer")));
  yield* awaited(message(system({ note: "From here on." }), "host.note"));
  yield* awaited(message(system({ preamble: "Baseline." }), "msa.system"));
  let view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "user:first",
    "assistant:answer",
    "system:note",
    "system:preamble",
  ]);

  const kept = yield* awaited(message(user("kept")));
  yield* awaited(message(assistant("kept answer")));
  yield* awaited(message(system({ mode: "plan" }), "host.note"));
  yield* awaited(append({ head: kept.id, kind: "summary", model: [user("summary")] }));
  yield* awaited(message(user("next")));
  yield* awaited(message(system({ preamble: "Baseline." }), "msa.system"));
  view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "user:summary",
    "user:kept",
    "assistant:kept answer",
    "system:mode",
    "user:next",
    "system:preamble",
  ]);
});

describe("conversation context", () => {
  it("keeps system messages other than the baseline in place once an assistant message precedes them", () =>
    Effect.runPromise(keepsSystemMessages));
});
