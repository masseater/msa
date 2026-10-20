import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessContextConversation3Cases from "./harness-context-conversation-3-cases.ts";
import type harnessContextConversation3CasesTypes from "./harness-context-conversation-3-cases.types.ts";
import harnessContextSupport from "./harness-context-support.ts";
import type harnessContextSupportTypes from "./harness-context-support.types.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { appendRandom, count, random, randomTranscript } = harnessContextConversation3Cases;
const { countingSetup, runInRoot } = harnessContextSupport;
const { assistant, describeMessage, system } = harnessSupport;
const { context } = sessionSupport;

afterEach(() => {
  vi.useRealTimers();
});

const checkRandomExtendedReads = Effect.fn("checkRandomExtendedReads")(function* (
  t: harnessContextConversation3CasesTypes.RandomTranscript,
  root: durableTypes.Conversation,
  runtime: harnessContextSupportTypes.RunRuntime,
  taskContext: harnessContextSupportTypes.Context,
) {
  for (const step of Array.from({ length: 150 }, (_, i) => i)) {
    yield* awaited(appendRandom(t, runtime, taskContext, root.id));
    const whole = yield* awaited(root.context(taskContext));
    expect(yield* awaited(runtime.context(root.id, taskContext))).toEqual(whole);
    const contributed = whole.contributions.flat();
    const first = contributed.findIndex((message) => message.role === "system");
    if (
      first > 0 &&
      whole.messages[0] === contributed[first] &&
      contributed.slice(0, first).some((message) => message.role === "assistant")
    ) {
      count(t, "baseline past assistant");
    }
    if (step % 10 === 9) {
      const at = t.written[random(t, t.written.length)]!.id;
      const [wholeInner, cut] = yield* awaited(
        Promise.all([
          runtime.context(root.id, taskContext),
          runtime.context(root.id, taskContext, { at }),
        ]),
      );
      expect(wholeInner).toEqual(yield* awaited(root.context(taskContext)));
      expect(cut).toEqual(yield* awaited(root.context(taskContext, { at })));
    }
  }
});

const checkRandomForkReads = Effect.fn("checkRandomForkReads")(function* (
  t: harnessContextConversation3CasesTypes.RandomTranscript,
  root: durableTypes.Conversation,
  runtime: harnessContextSupportTypes.RunRuntime,
  taskContext: harnessContextSupportTypes.Context,
) {
  const fork = yield* awaited(
    root.fork(
      t.written[random(t, t.written.length)]!.id,
      { ownership: { kind: "ownerless" } },
      taskContext,
    ),
  );
  for (const _ of Array.from({ length: 20 })) {
    expect(yield* awaited(runtime.context(fork.id, taskContext))).toEqual(
      yield* awaited(fork.context(taskContext)),
    );
    yield* awaited(appendRandom(t, runtime, taskContext, fork.id));
  }
});

function contextProbe(
  { root, scanned }: harnessContextSupportTypes.Counting,
  runtime: harnessContextSupportTypes.RunRuntime,
  taskContext: harnessContextSupportTypes.Context,
) {
  const append = (
    conversationId: durableTypes.Conversation["id"],
    draft: durableTypes.EntryDraft,
  ) =>
    runtime.commit(
      (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.appendEntry(conversationId, draft));
            return undefined;
          }),
        ),
      taskContext,
    );
  const read = (conversation: typeof root) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const before = scanned.rows;
        const view = yield* awaited(runtime.context(conversation.id, taskContext));
        const rows = scanned.rows - before;
        expect(view).toEqual(yield* awaited(conversation.context(taskContext)));
        return { messages: view.messages.map(describeMessage), rows };
      }),
    );
  return { append, read };
}

type ContextProbe = ReturnType<typeof contextProbe>;

const checkBaselineAfterCachedAnswers = Effect.fn("checkBaselineAfterCachedAnswers")(function* (
  { append, read }: ContextProbe,
  root: durableTypes.Conversation,
) {
  expect((yield* awaited(read(root))).messages[0]).toBe("user:first");
  yield* awaited(append(root.id, { kind: "msa.system", model: [system({ plan: "Plan." })] }));
  const extended = yield* awaited(read(root));
  expect(extended.rows).toBe(2);
  expect(extended.messages.slice(0, 3)).toEqual(["system:plan", "user:first", "assistant:old 0"]);
});

const checkSystemBeforeBaseline = Effect.fn("checkSystemBeforeBaseline")(function* (
  { append, read }: ContextProbe,
  { root, first }: harnessContextSupportTypes.Counting,
  taskContext: harnessContextSupportTypes.Context,
) {
  const fork = yield* awaited(
    root.fork(first.id, { ownership: { kind: "ownerless" } }, taskContext),
  );
  yield* awaited(append(fork.id, { kind: "message", model: [assistant("answer")] }));
  yield* awaited(append(fork.id, { kind: "host.system", model: [system({ note: "Note." })] }));
  expect((yield* awaited(read(fork))).messages).toEqual([
    "user:first",
    "assistant:answer",
    "system:note",
  ]);
  yield* awaited(append(fork.id, { kind: "msa.system", model: [system({ note: null })] }));
  const extended = yield* awaited(read(fork));
  expect(extended.rows).toBe(2);
  expect(extended.messages).toEqual([
    "user:first",
    "assistant:answer",
    "system:note",
    "system:note",
  ]);
});

const checkOmittedSystemBeforeBaseline = Effect.fn("checkOmittedSystemBeforeBaseline")(function* (
  { append, read }: ContextProbe,
  { root, first }: harnessContextSupportTypes.Counting,
  runtime: harnessContextSupportTypes.RunRuntime,
  taskContext: harnessContextSupportTypes.Context,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const omitted = yield* awaited(
    root.fork(first.id, { ownership: { kind: "ownerless" } }, taskContext),
  );
  yield* awaited(append(omitted.id, { kind: "message", model: [assistant("answer")] }));
  let host: durableTypes.EntryRecord | undefined;
  yield* awaited(
    runtime.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            host = yield* awaited(
              tx.appendEntry(omitted.id, {
                kind: "host.system",
                model: [system({ legacy: "Legacy." })],
              }),
            );
            return undefined;
          }),
        ),
      taskContext,
    ),
  );
  yield* awaited(
    append(omitted.id, { edits: [{ action: "omit", target: host!.id }], kind: "edit" }),
  );
  expect((yield* awaited(read(omitted))).messages).toEqual(["user:first", "assistant:answer"]);
  yield* awaited(append(omitted.id, { kind: "msa.system", model: [system({ legacy: null })] }));
  const extended = yield* awaited(read(omitted));
  expect(extended.rows).toBe(2);
  expect(extended.messages).toEqual(["user:first", "assistant:answer", "system:legacy"]);
});

const checkEmptyFirstSystemEntry = Effect.fn("checkEmptyFirstSystemEntry")(function* (
  { append, read }: ContextProbe,
  { root, first }: harnessContextSupportTypes.Counting,
  taskContext: harnessContextSupportTypes.Context,
) {
  const empty = yield* awaited(
    root.fork(first.id, { ownership: { kind: "ownerless" } }, taskContext),
  );
  yield* awaited(append(empty.id, { kind: "msa.system" }));
  yield* awaited(append(empty.id, { kind: "message", model: [assistant("answer")] }));
  expect((yield* awaited(read(empty))).messages).toEqual(["user:first", "assistant:answer"]);
  yield* awaited(append(empty.id, { kind: "msa.system", model: [system({ s: "Delta." })] }));
  const extended = yield* awaited(read(empty));
  expect(extended.rows).toBe(2);
  expect(extended.messages).toEqual(["user:first", "assistant:answer", "system:s"]);
});

const derivesSameView = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const opened = yield* countingSetup();
  const transcript = randomTranscript();
  yield* runInRoot(opened, "test.context-steps", (runtime, taskContext) =>
    runPromise(
      Effect.gen(function* () {
        yield* checkRandomExtendedReads(transcript, opened.root, runtime, taskContext);
        yield* checkRandomForkReads(transcript, opened.root, runtime, taskContext);
      }),
    ),
  );
  const categories = [
    "user",
    "assistant",
    "aborted",
    "error",
    "deferred",
    "result",
    "stray result",
    "system",
    "baseline system",
    "baseline past assistant",
    "note",
  ];
  for (const category of [...categories, "omit", "replace", "head"])
    expect(transcript.seen.get(category)).toBeGreaterThan(0);
  yield* awaited(opened.harness.close(context));
});

const findsBaselineAmong = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const opened = yield* countingSetup();
  yield* runInRoot(opened, "test.context-baseline", (runtime, taskContext) =>
    runPromise(
      Effect.gen(function* () {
        const probe = contextProbe(opened, runtime, taskContext);
        yield* checkBaselineAfterCachedAnswers(probe, opened.root);
        yield* checkSystemBeforeBaseline(probe, opened, taskContext);
        yield* checkOmittedSystemBeforeBaseline(probe, opened, runtime, taskContext);
        yield* checkEmptyFirstSystemEntry(probe, opened, taskContext);
      }),
    ),
  );
  yield* awaited(opened.harness.close(context));
});

describe("conversation context", () => {
  it("derives the same view from extended reads as from whole reads", () =>
    Effect.runPromise(derivesSameView));

  it("finds the baseline among the entries an extended read adds", () =>
    Effect.runPromise(findsBaselineAmong));
});
