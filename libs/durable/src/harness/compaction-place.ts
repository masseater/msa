import type { Context, Draft } from "@msa/chord";
import { Effect, Function } from "effect";

import { CompactionEntry } from "../entries.ts";
import { commitTask } from "./bridge.ts";
import { SUMMARY_PREFIX, SUMMARY_SUFFIX } from "./compaction-prompt.ts";
import type { CompactionNext, CompactionRuntime, CompactionTask } from "./compaction-types.ts";
import { failCompactionStatus, type LiveState, LiveDoc, removeCompactionStatus } from "./live.ts";
import { admitSubmission } from "./submissions-admit.ts";
import type { CompactionResult, Dual3, Dual4, EntryDraft, EntryId, Tx } from "./types.ts";

type Current = CompactionTask;

export const placeSummary: Dual4<
  Tx,
  CompactionRuntime,
  { readonly current: Current; readonly live: Draft<LiveState> },
  { readonly firstKept: EntryId; readonly summary: string },
  Effect.Effect<CompactionNext>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    tx: Tx,
    runtime: CompactionRuntime,
    state: { readonly current: Current; readonly live: Draft<LiveState> },
    summary: { readonly firstKept: EntryId; readonly summary: string },
  ) {
    const { current, live } = state;
    removeCompactionStatus(live, runtime.taskId);
    delete live.compactionFailure;
    const text = `${SUMMARY_PREFIX}${summary.summary}${SUMMARY_SUFFIX}`;
    const entry = {
      kind: CompactionEntry.kind,
      head: summary.firstKept,
      model: [{ role: "user", content: [{ type: "text", text }], timestamp: runtime.now() }],
      data: { reason: current.input.reason },
    } satisfies EntryDraft;
    const result: CompactionResult =
      current.owner === undefined
        ? {
            submissionId: yield* admitSubmission(
              tx,
              runtime.conversationId,
              { type: "write", requestId: `compaction:${runtime.taskId}`, entry },
              runtime.now(),
              runtime.settings,
            ),
          }
        : {
            entryId: (yield* Effect.promise(() => tx.appendEntry(runtime.conversationId, entry)))
              .id,
          };
    return { status: "terminal", outcome: { status: "completed", result } };
  }),
);

export const place: Dual4<
  CompactionRuntime,
  EntryId,
  string,
  Context,
  Effect.Effect<void>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    runtime: CompactionRuntime,
    firstKept: EntryId,
    summary: string,
    context: Context,
  ) {
    yield* commitTask(
      runtime,
      (tx: Tx, current: Current): Effect.Effect<CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          return yield* placeSummary(tx, runtime, { current, live }, { firstKept, summary });
        }),
      context,
    );
  }),
);

export const complete: Dual2Context = Function.dual(
  2,
  Effect.fnUntraced(function* (runtime: CompactionRuntime, context: Context) {
    yield* commitTask(
      runtime,
      (tx: Tx): Effect.Effect<CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          removeCompactionStatus(live, runtime.taskId);
          return { status: "terminal", outcome: { status: "completed", result: {} } };
        }),
      context,
    );
  }),
);

export const abortCompaction: Dual2Context = Function.dual(
  2,
  Effect.fnUntraced(function* (runtime: CompactionRuntime, context: Context) {
    yield* commitTask(
      runtime,
      (tx: Tx): Effect.Effect<CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          removeCompactionStatus(live, runtime.taskId);
          return { status: "terminal", outcome: { status: "aborted" } };
        }),
      context,
    );
  }),
);

type Dual2Context = {
  (context: Context): (runtime: CompactionRuntime) => Effect.Effect<void>;
  (runtime: CompactionRuntime, context: Context): Effect.Effect<void>;
};

export const failNoModel: Dual3<
  CompactionRuntime,
  { readonly provider: string; readonly modelId: string } | undefined,
  Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: CompactionRuntime,
    ref: { readonly provider: string; readonly modelId: string } | undefined,
    context: Context,
  ) {
    const message =
      ref === undefined
        ? "No model is configured"
        : `Model ${ref.provider}/${ref.modelId} is not available`;
    yield* commitTask(
      runtime,
      (tx: Tx): Effect.Effect<CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          failCompactionStatus(live, runtime.taskId, message);
          return {
            status: "terminal",
            outcome: { status: "failed", error: { message, detail: { reason: "no_model" } } },
          };
        }),
      context,
    );
  }),
);
