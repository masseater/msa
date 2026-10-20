import type { Context } from "@msa/chord";
import { type Conversation, type EntryDraft } from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import type harnessContextConversation3CasesTypes from "./harness-context-conversation-3-cases.types.ts";
import type harnessContextSupportTypes from "./harness-context-support.types.ts";
import harnessSupport from "./harness-support.ts";

const { awaited } = effectSupport;
const { assistant, system, toolResult, user } = harnessSupport;

function randomTranscript(): harnessContextConversation3CasesTypes.RandomTranscript {
  return { calls: [], next: 0, seed: 7, seen: new Map(), written: [] };
}

function randomImpl(
  transcript: harnessContextConversation3CasesTypes.RandomTranscript,
  n: number,
): number {
  transcript.seed = (Math.imul(transcript.seed, 1_664_525) + 1_013_904_223) >>> 0;
  return Math.floor((transcript.seed / 2 ** 32) * n);
}

const random: {
  (n: number): (transcript: harnessContextConversation3CasesTypes.RandomTranscript) => number;
  (transcript: harnessContextConversation3CasesTypes.RandomTranscript, n: number): number;
} = dual(2, randomImpl);

function countImpl(
  transcript: harnessContextConversation3CasesTypes.RandomTranscript,
  category: string,
): void {
  transcript.seen.set(category, (transcript.seen.get(category) ?? 0) + 1);
}

const count: {
  (category: string): (transcript: harnessContextConversation3CasesTypes.RandomTranscript) => void;
  (transcript: harnessContextConversation3CasesTypes.RandomTranscript, category: string): void;
} = dual(2, countImpl);

function randomMessageDraft(
  t: harnessContextConversation3CasesTypes.RandomTranscript,
  pick: number,
): EntryDraft | undefined {
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
      model: [
        assistant(`a${t.next++}`, {
          calls: ids,
          ...(stopReason === undefined ? {} : { stopReason }),
        }),
      ],
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
    return { data: { n: t.next++ }, kind: "note" };
  }
  return undefined;
}

function randomEditDraft(
  t: harnessContextConversation3CasesTypes.RandomTranscript,
  pick: number,
): EntryDraft {
  const target = t.written[random(t, t.written.length)];
  if (pick < 12 && target !== undefined) {
    const omit = random(t, 2) === 0;
    count(t, omit ? "omit" : "replace");
    const action = omit
      ? { action: "omit" as const }
      : { action: "replace" as const, messages: [user(`r${t.next++}`)] };
    return { edits: [{ target: target.id, ...action }], kind: "edit" };
  }
  if (pick < 13 && target !== undefined) {
    count(t, "head");
    return { head: target.id, kind: "summary", model: [user(`h${t.next++}`)] };
  }
  count(t, "user");
  return { kind: "message", model: [user(`u${t.next++}`)] };
}

function randomDraft(t: harnessContextConversation3CasesTypes.RandomTranscript): EntryDraft {
  const pick = random(t, 14);
  return randomMessageDraft(t, pick) ?? randomEditDraft(t, pick);
}

function appendRandomImpl(
  t: harnessContextConversation3CasesTypes.RandomTranscript,
  runtime: harnessContextSupportTypes.RunRuntime,
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

const appendRandom: {
  (
    runtime: harnessContextSupportTypes.RunRuntime,
    taskContext: Context,
    conversationId: Conversation["id"],
  ): (t: harnessContextConversation3CasesTypes.RandomTranscript) => Promise<void>;
  (
    t: harnessContextConversation3CasesTypes.RandomTranscript,
    runtime: harnessContextSupportTypes.RunRuntime,
    taskContext: Context,
    conversationId: Conversation["id"],
  ): Promise<void>;
} = dual(4, appendRandomImpl);

const harnessContextConversation3Cases = {
  appendRandom,
  count,
  random,
  randomDraft,
  randomTranscript,
};

export default harnessContextConversation3Cases;
