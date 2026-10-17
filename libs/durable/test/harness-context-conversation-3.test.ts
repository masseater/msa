import type { Context } from "@msa/chord";
import { type EntryDraft, type EntryRecord, type Conversation } from "@msa/durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

// Deterministic pseudo-random transcript (32-bit LCG, high bits): calls and results in any order, missing and stray
// results, excluded stop reasons, system entries, notes, edits of earlier entries, and head markers. `seen` counts the
// categories drawn.
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

// The draft for a `pick` below 10: a message or a note.
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
    // `msa.system` entries can be the baseline that leads the context (#10904).
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

// The draft for a `pick` of 10 or more: an edit or head marker over a written entry, or else a user message.
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

// Append one to three random entries to `conversationId` in one commit.
function appendRandom(
  t: RandomTranscript,
  runtime: RunRuntime,
  taskContext: Context,
  conversationId: Conversation["id"],
) {
  return runtime.commit(async (tx) => {
    const added = 1 + random(t, 3);
    for await (const _ of Array.from({ length: added })) {
      t.written.push(await tx.appendEntry(conversationId, randomDraft(t)));
    }
    return undefined;
  }, taskContext);
}

async function checkRandomExtendedReads(
  t: RandomTranscript,
  root: Conversation,
  runtime: RunRuntime,
  taskContext: Context,
): Promise<void> {
  for await (const step of Array.from({ length: 150 }, (_, i) => i)) {
    await appendRandom(t, runtime, taskContext, root.id);
    const whole = await root.context(taskContext);
    expect(await runtime.context(root.id, taskContext)).toEqual(whole);
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
      // Overlapping reads, one with an earlier cutoff, share the kept range.
      const at = t.written[random(t, t.written.length)]!.id;
      const [whole, cut] = await Promise.all([
        runtime.context(root.id, taskContext),
        runtime.context(root.id, taskContext, { at }),
      ]);
      expect(whole).toEqual(await root.context(taskContext));
      expect(cut).toEqual(await root.context(taskContext, { at }));
    }
  }
}

// A fork sees its parent's entries through the fork point and extends with its own.
async function checkRandomForkReads(
  t: RandomTranscript,
  root: Conversation,
  runtime: RunRuntime,
  taskContext: Context,
): Promise<void> {
  const fork = await root.fork(
    t.written[random(t, t.written.length)]!.id,
    { ownership: { kind: "ownerless" } },
    taskContext,
  );
  for await (const _ of Array.from({ length: 20 })) {
    expect(await runtime.context(fork.id, taskContext)).toEqual(await fork.context(taskContext));
    await appendRandom(t, runtime, taskContext, fork.id);
  }
}

// `append` commits a draft; `read` reads a conversation's context in the task, checks it against a fresh read, and
// returns its messages and the rows it scanned.
function contextProbe({ root, scanned }: Counting, runtime: RunRuntime, taskContext: Context) {
  const append = (conversationId: Conversation["id"], draft: EntryDraft) =>
    runtime.commit(async (tx) => {
      await tx.appendEntry(conversationId, draft);
      return undefined;
    }, taskContext);
  const read = async (conversation: typeof root) => {
    const before = scanned.rows;
    const view = await runtime.context(conversation.id, taskContext);
    const rows = scanned.rows - before;
    expect(view).toEqual(await conversation.context(taskContext));
    return { messages: view.messages.map(describeMessage), rows };
  };
  return { append, read };
}

type ContextProbe = ReturnType<typeof contextProbe>;

// The cached range has answers and no system message; the baseline arrives in a later read.
async function checkBaselineAfterCachedAnswers({ append, read }: ContextProbe, root: Conversation) {
  expect((await read(root)).messages[0]).toBe("user:first");
  await append(root.id, { kind: "msa.system", model: [system({ plan: "Plan." })] });
  const extended = await read(root);
  // One bounds probe and the added entry: the range was extended, not derived again.
  expect(extended.rows).toBe(2);
  expect(extended.messages.slice(0, 3)).toEqual(["system:plan", "user:first", "assistant:old 0"]);
}

// A system message the cached range already has keeps a later first `msa.system` entry in place.
async function checkSystemBeforeBaseline(
  { append, read }: ContextProbe,
  { root, first }: Counting,
  taskContext: Context,
) {
  const fork = await root.fork(first.id, { ownership: { kind: "ownerless" } }, taskContext);
  await append(fork.id, { kind: "message", model: [assistant("answer")] });
  await append(fork.id, { kind: "host.system", model: [system({ note: "Note." })] });
  expect((await read(fork)).messages).toEqual(["user:first", "assistant:answer", "system:note"]);
  await append(fork.id, { kind: "msa.system", model: [system({ note: null })] });
  const extended = await read(fork);
  expect(extended.rows).toBe(2);
  expect(extended.messages).toEqual([
    "user:first",
    "assistant:answer",
    "system:note",
    "system:note",
  ]);
}

// An omitted system message still rules out a later baseline; the extended read keeps that.
async function checkOmittedSystemBeforeBaseline(
  { append, read }: ContextProbe,
  { root, first }: Counting,
  runtime: RunRuntime,
  taskContext: Context,
) {
  const omitted = await root.fork(first.id, { ownership: { kind: "ownerless" } }, taskContext);
  await append(omitted.id, { kind: "message", model: [assistant("answer")] });
  let host: EntryRecord | undefined;
  await runtime.commit(async (tx) => {
    host = await tx.appendEntry(omitted.id, {
      kind: "host.system",
      model: [system({ legacy: "Legacy." })],
    });
    return undefined;
  }, taskContext);
  await append(omitted.id, { kind: "edit", edits: [{ target: host!.id, action: "omit" }] });
  expect((await read(omitted)).messages).toEqual(["user:first", "assistant:answer"]);
  await append(omitted.id, { kind: "msa.system", model: [system({ legacy: null })] });
  const extended = await read(omitted);
  expect(extended.rows).toBe(2);
  expect(extended.messages).toEqual(["user:first", "assistant:answer", "system:legacy"]);
}

// A first `msa.system` entry without a system message leaves no baseline for a later one to take.
async function checkEmptyFirstSystemEntry(
  { append, read }: ContextProbe,
  { root, first }: Counting,
  taskContext: Context,
) {
  const empty = await root.fork(first.id, { ownership: { kind: "ownerless" } }, taskContext);
  await append(empty.id, { kind: "msa.system" });
  await append(empty.id, { kind: "message", model: [assistant("answer")] });
  expect((await read(empty)).messages).toEqual(["user:first", "assistant:answer"]);
  await append(empty.id, { kind: "msa.system", model: [system({ s: "Delta." })] });
  const extended = await read(empty);
  expect(extended.rows).toBe(2);
  expect(extended.messages).toEqual(["user:first", "assistant:answer", "system:s"]);
}

describe("conversation context", () => {
  it("derives the same view from extended reads as from whole reads", async () => {
    const opened = await countingSetup();
    const transcript = randomTranscript();
    await runInRoot(opened, "test.context-steps", async (runtime, taskContext) => {
      await checkRandomExtendedReads(transcript, opened.root, runtime, taskContext);
      await checkRandomForkReads(transcript, opened.root, runtime, taskContext);
    });
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
    await opened.harness.close(context);
  });

  // #10904
  it("finds the baseline among the entries an extended read adds", async () => {
    const opened = await countingSetup();
    await runInRoot(opened, "test.context-baseline", async (runtime, taskContext) => {
      const probe = contextProbe(opened, runtime, taskContext);
      await checkBaselineAfterCachedAnswers(probe, opened.root);
      await checkSystemBeforeBaseline(probe, opened, taskContext);
      await checkOmittedSystemBeforeBaseline(probe, opened, runtime, taskContext);
      await checkEmptyFirstSystemEntry(probe, opened, taskContext);
    });
    await opened.harness.close(context);
  });
});
