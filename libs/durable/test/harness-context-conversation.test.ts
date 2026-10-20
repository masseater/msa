import type { Context } from "@msa/chord";
import { type ContextView, type EntryDraft, type EntryId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessContextSupport from "./harness-context-support.ts";
import type harnessContextSupportTypes from "./harness-context-support.types.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { countingSetup, runInRoot, setup } = harnessContextSupport;
const { assistant, describeMessage, system, toolResult, user } = harnessSupport;
const { context } = sessionSupport;

afterEach(() => {
  vi.useRealTimers();
});

function checkExtendedReads(
  { root, first, scanned }: harnessContextSupportTypes.Counting,
  runtime: harnessContextSupportTypes.RunRuntime,
  taskContext: Context,
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const write = (draft: EntryDraft) =>
        runtime.commit((tx) => tx.appendEntry(root.id, draft).then(() => undefined), taskContext);
      const read = (at?: EntryId): Promise<{ view: ContextView; rows: number }> =>
        runPromise(
          Effect.gen(function* () {
            const before = scanned.rows;
            const view = yield* awaited(
              runtime.context(root.id, taskContext, at === undefined ? {} : { at }),
            );
            return { rows: scanned.rows - before, view };
          }),
        );
      const initial = yield* awaited(read());
      expect(initial.view).toEqual(yield* awaited(root.context(taskContext)));

      yield* awaited(write({ kind: "message", model: [user("new")] }));
      yield* awaited(write({ data: { text: "display only" }, kind: "note" }));
      yield* awaited(write({ kind: "message", model: [assistant("answer")] }));
      const extended = yield* awaited(read());
      expect(extended.rows).toBe(4);
      expect(extended.view).toEqual(yield* awaited(root.context(taskContext)));

      yield* awaited(write({ edits: [{ action: "omit", target: first.id }], kind: "edit" }));
      const edited = yield* awaited(read());
      expect(edited.rows).toBe(2);
      expect(edited.view).toEqual(yield* awaited(root.context(taskContext)));
      expect(edited.view.messages.map(describeMessage)).not.toContain("user:first");

      const cutoff = yield* awaited(read(extended.view.entries.at(-1)!.id));
      expect(cutoff.rows).toBe(0);
      expect(cutoff.view).toEqual(extended.view);

      yield* awaited(write({ head: "self", kind: "reset", model: [user("fresh")] }));
      const reset = yield* awaited(read());
      expect(reset.view).toEqual(yield* awaited(root.context(taskContext)));
      expect(reset.view.messages.map(describeMessage)).toEqual(["user:fresh"]);
    }),
  );
}

const summaryOverRetainedSystem = Effect.fn("summaryOverRetainedSystem")(function* () {
  const { root, message, append } = yield* setup();
  const kept = yield* awaited(message(user("kept")));
  yield* awaited(message(assistant("answer")));
  const retained = yield* awaited(message(system({ cwd: "/repo" }), "msa.system"));
  yield* awaited(append({ head: kept.id, kind: "summary", model: [user("summary")] }));
  yield* awaited(message(user("next")));
  const view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "user:summary",
    "user:kept",
    "assistant:answer",
    "system:cwd",
    "user:next",
  ]);
  return { append, message, retained, root };
});

const baselineOverRetainedSystem = Effect.fn("baselineOverRetainedSystem")(function* () {
  const { root, message, append, retained } = yield* summaryOverRetainedSystem();

  const baseline = yield* awaited(
    append({
      edits: [{ action: "omit", target: retained.id }],
      kind: "msa.system",
      model: [system({ preamble: "Baseline." })],
    }),
  );
  yield* awaited(message(assistant("done")));
  yield* awaited(message(system({ preamble: null }), "msa.system"));
  return { append, baseline, root };
});

const doesNotLead = Effect.gen(function* () {
  const { root, message, append } = yield* setup();
  const host = yield* awaited(message(system({ legacy: "Use the legacy format." }), "host.system"));
  yield* awaited(message(user("first")));
  yield* awaited(message(assistant("answer")));
  yield* awaited(message(system({ legacy: null }), "msa.system"));
  yield* awaited(append({ edits: [{ action: "omit", target: host.id }], kind: "edit" }));
  let view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "user:first",
    "assistant:answer",
    "system:legacy",
  ]);

  const other = yield* setup();
  const first = yield* awaited(other.message(user("first")));
  yield* awaited(
    other.append({
      edits: [
        {
          action: "replace",
          messages: [user("first"), system({ note: "Note." })],
          target: first.id,
        },
      ],
      kind: "edit",
    }),
  );
  yield* awaited(other.message(assistant("answer")));
  yield* awaited(other.message(system({ note: null }), "msa.system"));
  yield* awaited(
    other.append({
      edits: [{ action: "replace", messages: [user("first")], target: first.id }],
      kind: "edit",
    }),
  );
  view = yield* awaited(other.root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "user:first",
    "assistant:answer",
    "system:note",
  ]);
});

describe("conversation context", () => {
  it("does not lead with a first system entry written after another system message, even once that is omitted", () =>
    Effect.runPromise(doesNotLead));
});

const doesNotLeadRetained = Effect.gen(function* () {
  const { root, append, baseline } = yield* baselineOverRetainedSystem();
  let view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "system:preamble",
    "user:summary",
    "user:kept",
    "assistant:answer",
    "user:next",
    "assistant:done",
    "system:preamble",
  ]);

  yield* awaited(append({ edits: [{ action: "omit", target: baseline.id }], kind: "edit" }));
  view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "user:summary",
    "user:kept",
    "assistant:answer",
    "user:next",
    "assistant:done",
    "system:preamble",
  ]);

  yield* awaited(
    append({
      edits: [{ action: "replace", messages: [system({ other: "Other." })], target: baseline.id }],
      kind: "edit",
    }),
  );
  view = yield* awaited(root.context(context));
  expect(view.messages.map(describeMessage)).toEqual([
    "user:summary",
    "user:kept",
    "assistant:answer",
    "user:next",
    "system:other",
    "assistant:done",
    "system:preamble",
  ]);
});

describe("conversation context", () => {
  it("does not lead with a retained, edited, or later system entry in place of the baseline", () =>
    Effect.runPromise(doesNotLeadRetained));
});

const synthesizesMissingTool = Effect.gen(function* () {
  const { root, message } = yield* setup();
  yield* awaited(message(user("go")));
  const call = yield* awaited(message(assistant("calling", { calls: ["x", "y"] })));
  yield* awaited(message(toolResult("x")));
  const second = yield* awaited(message(toolResult("y")));
  const child = yield* awaited(root.fork(call.id, { ownership: { kind: "ownerless" } }, context));
  const childView = yield* awaited(child.context(context));
  expect(childView.messages.map(describeMessage)).toEqual([
    "user:go",
    "assistant:calling",
    "result:x:error",
    "result:y:error",
  ]);
  const missing = childView.messages[2]!;
  expect(missing).toMatchObject({
    details: { reason: "missing_result" },
    role: "toolResult",
    toolName: "tool-x",
  });

  yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { head: second.id, kind: "reset" }), context),
  );
  const parentView = yield* awaited(root.context(context));
  expect(parentView.messages.map(describeMessage)).toEqual([]);
  expect(parentView.entries.map((entry) => entry.kind)).toEqual(["reset", "message"]);
});

describe("conversation context", () => {
  it("synthesizes missing tool results after a fork and drops results cut from their call", () =>
    Effect.runPromise(synthesizesMissingTool));
});

const readsContextEarlier = Effect.gen(function* () {
  const { root, append, message } = yield* setup();
  const first = yield* awaited(message(user("first")));
  const call = yield* awaited(message(assistant("calling", { calls: ["x", "y"] })));
  const result = yield* awaited(message(toolResult("x")));
  yield* awaited(message(toolResult("y")));
  const edit = yield* awaited(
    append({
      edits: [{ action: "replace", messages: [user("first v2")], target: first.id }],
      kind: "edit",
    }),
  );
  const reset = yield* awaited(
    append({ head: "self", kind: "reset", model: [user("fresh start")] }),
  );
  const tail = yield* awaited(message(assistant("after reset")));

  for (const at of [first, call, result, edit, reset, tail]) {
    const fork = yield* awaited(root.fork(at.id, { ownership: { kind: "ownerless" } }, context));
    expect(yield* awaited(root.context(context, { at: at.id }))).toEqual(
      yield* awaited(fork.context(context)),
    );
  }
  expect(
    (yield* awaited(root.context(context, { at: call.id }))).messages.map(describeMessage),
  ).toEqual(["user:first", "assistant:calling", "result:x:error", "result:y:error"]);
  expect(yield* awaited(root.context(context, { at: tail.id }))).toEqual(
    yield* awaited(root.context(context)),
  );
  expect(yield* awaited(root.context(context, {}))).toEqual(yield* awaited(root.context(context)));

  const other = yield* awaited(root.fork(first.id, { ownership: { kind: "ownerless" } }, context));
  yield* awaited(expect(other.context(context, { at: tail.id })).rejects.toThrow("is not visible"));
});

const extendsTaskContext = Effect.gen(function* () {
  const opened = yield* countingSetup();
  yield* runInRoot(opened, "test.context-reads", (runtime, taskContext) =>
    checkExtendedReads(opened, runtime, taskContext),
  );
  yield* awaited(opened.harness.close(context));
});

describe("conversation context", () => {
  it("reads the context as of an earlier entry, as a fork at that entry starts", () =>
    Effect.runPromise(readsContextEarlier));

  it("extends a task's context read with only newer entries", () =>
    Effect.runPromise(extendsTaskContext));
});
