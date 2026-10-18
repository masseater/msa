import type { Context } from "@msa/chord";
import { type EntryDraft, type EntryRecord, type Conversation } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  countingSetup,
  type Counting,
  type RunRuntime,
  runInRoot,
} from "./harness-context-support.ts";
import { assistant, describeMessage, system, toolResult, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

type RandomTranscript = {
  seed: number;
  next: number;
  readonly written: EntryRecord[];
  readonly calls: string[];
  readonly seen: Map<string, number>;
};

function randomTranscript(): RandomTranscript {
  return { seed: 7, next: 0, written: [], calls: [], seen: new Map() };
}

function random(transcript: RandomTranscript, n: number): number {
  transcript.seed = (Math.imul(transcript.seed, 1_664_525) + 1_013_904_223) >>> 0;
  return Math.floor((transcript.seed / 2 ** 32) * n);
}

function count(transcript: RandomTranscript, category: string): void {
  transcript.seen.set(category, (transcript.seen.get(category) ?? 0) + 1);
}

function randomMessageDraft(t: RandomTranscript, pick: number): EntryDraft | undefined {
  if (pick < 3) {
    count(t, "user");
    return { kind: "message", model: [user(`u${t.next++}`)] };
  }
  if (pick < 5) {
    const ids = Array.from({ length: random(t, 3) }, () => `c${t.next++}`);
    t.calls.push(...ids);
    const stopReason = (["aborted", "error", "deferred"] as const)[random(t, 9)];
    count(t, stopReason ?? "assistant");
    return {
      kind: "message",
      model: [assistant(`a${t.next++}`, { calls: ids, ...(stopReason ? { stopReason } : {}) })],
    };
  }
  if (pick < 8) {
    const matched = t.calls.length > 0 && random(t, 5) > 0;
    count(t, matched ? "result" : "stray result");
    const id = matched ? t.calls.splice(random(t, t.calls.length), 1)[0]! : `stray${t.next++}`;
    return { kind: "message", model: [toolResult(id)] };
  }
  if (pick < 9) {
    const kind = random(t, 2) === 0 ? "msa.system" : "message";
    count(t, kind === "msa.system" ? "baseline system" : "system");
    return { kind, model: [system({ s: `v${t.next++}` })] };
  }
  if (pick < 10) {
    count(t, "note");
    return { kind: "note", data: { n: t.next++ } };
  }
  return undefined;
}

function randomEditDraft(t: RandomTranscript, pick: number): EntryDraft {
  const target = t.written[random(t, t.written.length)];
  if (pick < 12 && target !== undefined) {
    const omit = random(t, 2) === 0;
    count(t, omit ? "omit" : "replace");
    const action = omit
      ? { action: "omit" as const }
      : { action: "replace" as const, messages: [user(`r${t.next++}`)] };
    return { kind: "edit", edits: [{ target: target.id, ...action }] };
  }
  if (pick < 13 && target !== undefined) {
    count(t, "head");
    return { kind: "summary", head: target.id, model: [user(`h${t.next++}`)] };
  }
  count(t, "user");
  return { kind: "message", model: [user(`u${t.next++}`)] };
}

function randomDraft(t: RandomTranscript): EntryDraft {
  const pick = random(t, 14);
  return randomMessageDraft(t, pick) ?? randomEditDraft(t, pick);
}

function appendRandom(
  t: RandomTranscript,
  runtime: RunRuntime,
  taskContext: Context,
  conversationId: Conversation["id"],
) {
  return runtime.commit(
    (tx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const added = 1 + random(t, 3);
          for (const _ of Array.from({ length: added })) {
            t.written.push(yield* awaited(tx.appendEntry(conversationId, randomDraft(t))));
          }
          return undefined;
        }),
      ),
    taskContext,
  );
}

const checkRandomExtendedReads = Effect.fn("checkRandomExtendedReads")(function* (
  t: RandomTranscript,
  root: Conversation,
  runtime: RunRuntime,
  taskContext: Context,
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
      const [whole, cut] = yield* awaited(
        Promise.all([
          runtime.context(root.id, taskContext),
          runtime.context(root.id, taskContext, { at }),
        ]),
      );
      expect(whole).toEqual(yield* awaited(root.context(taskContext)));
      expect(cut).toEqual(yield* awaited(root.context(taskContext, { at })));
    }
  }
});

const checkRandomForkReads = Effect.fn("checkRandomForkReads")(function* (
  t: RandomTranscript,
  root: Conversation,
  runtime: RunRuntime,
  taskContext: Context,
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

function contextProbe({ root, scanned }: Counting, runtime: RunRuntime, taskContext: Context) {
  const append = (conversationId: Conversation["id"], draft: EntryDraft) =>
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
  root: Conversation,
) {
  expect((yield* awaited(read(root))).messages[0]).toBe("user:first");
  yield* awaited(append(root.id, { kind: "msa.system", model: [system({ plan: "Plan." })] }));
  const extended = yield* awaited(read(root));
  expect(extended.rows).toBe(2);
  expect(extended.messages.slice(0, 3)).toEqual(["system:plan", "user:first", "assistant:old 0"]);
});

const checkSystemBeforeBaseline = Effect.fn("checkSystemBeforeBaseline")(function* (
  { append, read }: ContextProbe,
  { root, first }: Counting,
  taskContext: Context,
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
  { root, first }: Counting,
  runtime: RunRuntime,
  taskContext: Context,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const omitted = yield* awaited(
    root.fork(first.id, { ownership: { kind: "ownerless" } }, taskContext),
  );
  yield* awaited(append(omitted.id, { kind: "message", model: [assistant("answer")] }));
  let host: EntryRecord | undefined;
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
    append(omitted.id, { kind: "edit", edits: [{ target: host!.id, action: "omit" }] }),
  );
  expect((yield* awaited(read(omitted))).messages).toEqual(["user:first", "assistant:answer"]);
  yield* awaited(append(omitted.id, { kind: "msa.system", model: [system({ legacy: null })] }));
  const extended = yield* awaited(read(omitted));
  expect(extended.rows).toBe(2);
  expect(extended.messages).toEqual(["user:first", "assistant:answer", "system:legacy"]);
});

const checkEmptyFirstSystemEntry = Effect.fn("checkEmptyFirstSystemEntry")(function* (
  { append, read }: ContextProbe,
  { root, first }: Counting,
  taskContext: Context,
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
