import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import entries from "../entries.ts";
import bridge from "./bridge.ts";
import compactionPrompt from "./compaction-prompt.ts";
import type compactionTypesModule from "./compaction-types.ts";
import liveModule from "./live.ts";
import type liveTypes from "./live.types.ts";
import submissionsAdmit from "./submissions-admit.ts";
import type typesModule from "./types.types.ts";

const { LiveDoc, failCompactionStatus, removeCompactionStatus } = liveModule;
const { SUMMARY_PREFIX, SUMMARY_SUFFIX } = compactionPrompt;
const { CompactionEntry } = entries;
const { commitTask } = bridge;

type Current = compactionTypesModule.CompactionTask;

const placeSummary: typesModule.Dual4<
  typesModule.Tx,
  compactionTypesModule.CompactionRuntime,
  { readonly current: Current; readonly live: chordTypes.Draft<liveTypes.LiveState> },
  { readonly firstKept: typesModule.EntryId; readonly summary: string },
  Effect.Effect<compactionTypesModule.CompactionNext>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    runtime: compactionTypesModule.CompactionRuntime,
    state: { readonly current: Current; readonly live: chordTypes.Draft<liveTypes.LiveState> },
    summary: { readonly firstKept: typesModule.EntryId; readonly summary: string },
  ) {
    const { current, live } = state;
    removeCompactionStatus(live, runtime.taskId);
    delete live.compactionFailure;
    const text = `${SUMMARY_PREFIX}${summary.summary}${SUMMARY_SUFFIX}`;
    const entry = {
      data: { reason: current.input.reason },
      head: summary.firstKept,
      kind: CompactionEntry.kind,
      model: [{ content: [{ text, type: "text" }], role: "user", timestamp: runtime.now() }],
    } satisfies typesModule.EntryDraft;
    const result: typesModule.CompactionResult =
      current.owner === undefined
        ? {
            submissionId: yield* submissionsAdmit.admitSubmission(
              tx,
              runtime.conversationId,
              { entry, requestId: `compaction:${runtime.taskId}`, type: "write" },
              runtime.now(),
              runtime.settings,
            ),
          }
        : {
            entryId: (yield* Effect.promise(() => tx.appendEntry(runtime.conversationId, entry)))
              .id,
          };
    return { outcome: { result, status: "completed" }, status: "terminal" };
  }),
);

const place: typesModule.Dual4<
  compactionTypesModule.CompactionRuntime,
  typesModule.EntryId,
  string,
  chordTypes.Context,
  Effect.Effect<void>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    runtime: compactionTypesModule.CompactionRuntime,
    firstKept: typesModule.EntryId,
    summary: string,
    context: chordTypes.Context,
  ) {
    yield* commitTask(
      runtime,
      (tx: typesModule.Tx, current: Current): Effect.Effect<compactionTypesModule.CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          return yield* placeSummary(tx, runtime, { current, live }, { firstKept, summary });
        }),
      context,
    );
  }),
);

const complete: Dual2Context = Function.dual(
  2,
  Effect.fnUntraced(function* (
    runtime: compactionTypesModule.CompactionRuntime,
    context: chordTypes.Context,
  ) {
    yield* commitTask(
      runtime,
      (tx: typesModule.Tx): Effect.Effect<compactionTypesModule.CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          removeCompactionStatus(live, runtime.taskId);
          return { outcome: { result: {}, status: "completed" }, status: "terminal" };
        }),
      context,
    );
  }),
);

const abortCompaction: Dual2Context = Function.dual(
  2,
  Effect.fnUntraced(function* (
    runtime: compactionTypesModule.CompactionRuntime,
    context: chordTypes.Context,
  ) {
    yield* commitTask(
      runtime,
      (tx: typesModule.Tx): Effect.Effect<compactionTypesModule.CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          removeCompactionStatus(live, runtime.taskId);
          return { outcome: { status: "aborted" }, status: "terminal" };
        }),
      context,
    );
  }),
);

type Dual2Context = {
  (
    context: chordTypes.Context,
  ): (runtime: compactionTypesModule.CompactionRuntime) => Effect.Effect<void>;
  (
    runtime: compactionTypesModule.CompactionRuntime,
    context: chordTypes.Context,
  ): Effect.Effect<void>;
};

const failNoModel: typesModule.Dual3<
  compactionTypesModule.CompactionRuntime,
  { readonly provider: string; readonly modelId: string } | undefined,
  chordTypes.Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: compactionTypesModule.CompactionRuntime,
    ref: { readonly provider: string; readonly modelId: string } | undefined,
    context: chordTypes.Context,
  ) {
    const message =
      ref === undefined
        ? "No model is configured"
        : `Model ${ref.provider}/${ref.modelId} is not available`;
    yield* commitTask(
      runtime,
      (tx: typesModule.Tx): Effect.Effect<compactionTypesModule.CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          failCompactionStatus(live, runtime.taskId, message);
          return {
            outcome: { error: { detail: { reason: "no_model" }, message }, status: "failed" },
            status: "terminal",
          };
        }),
      context,
    );
  }),
);

const compactionPlace = {
  abortCompaction,
  complete,
  failNoModel,
  place,
  placeSummary,
};

export default compactionPlace;
