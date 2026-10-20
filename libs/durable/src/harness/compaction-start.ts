import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import bridge from "./bridge.ts";
import compactionPlace from "./compaction-place.ts";
import compactionSelect from "./compaction-select.ts";
import type compactionTypesModule from "./compaction-types.ts";
import compactionModule from "./compaction.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";

const { LiveDoc, addCompactionStatus } = liveModule;
const { commitTask, eachHook, hookResult } = bridge;
const { selectCut, summarizedMessages } = compactionSelect;

const createCompaction: {
  (
    conversationId: typesModule.ConversationId,
    input: compactionTypesModule.CompactionInput,
    owner?: typesModule.TaskId,
  ): (tx: typesModule.Tx) => Effect.Effect<compactionTypesModule.CompactionTaskId>;
  (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    input: compactionTypesModule.CompactionInput,
    owner?: typesModule.TaskId,
  ): Effect.Effect<compactionTypesModule.CompactionTaskId>;
} = Function.dual(
  (args: IArguments) => typeof args[0] !== "number",
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    input: compactionTypesModule.CompactionInput,
    owner?: typesModule.TaskId,
  ) {
    const ownership =
      owner === undefined
        ? ({ kind: "conversation" } as const)
        : { kind: "task" as const, taskId: owner };
    const background = owner === undefined && input.reason !== "manual";
    const taskId = yield* Effect.promise(() =>
      tx.createTask(compactionModule.CompactionTask, input, {
        background,
        conversationId,
        ownership,
      }),
    );
    const status = { attempt: 1, blocking: owner !== undefined, reason: input.reason, taskId };
    const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
    addCompactionStatus(live, status);
    return taskId;
  }),
);

type Decision = { readonly decline: true } | { readonly summary: string } | undefined;

type CompactionRequest = Parameters<NonNullable<typesModule.CompactionHooks["beforeCompact"]>>[0];

const askHooks = Effect.fnUntraced(function* (
  runtime: compactionTypesModule.CompactionRuntime,
  compaction: CompactionRequest,
  context: chordTypes.Context,
) {
  let decision: Decision;
  yield* eachHook(runtime.hooks, "beforeCompact", (hook) =>
    decision === undefined
      ? Effect.map(
          hookResult(() => hook(compaction, runtime, context)),
          (made) => {
            decision = made;
          },
        )
      : Effect.void,
  );
  return decision;
});

const summaryMaxTokens = (reserveTokens: number, modelMaxTokens: number): number =>
  Math.min(
    Math.floor(0.8 * reserveTokens),
    modelMaxTokens > 0 ? modelMaxTokens : Number.POSITIVE_INFINITY,
  );

const latestEntryId = (
  entries: readonly { readonly id: typesModule.EntryId }[],
  floor: typesModule.EntryId,
): typesModule.EntryId =>
  entries.reduce((tail, entry) => (entry.id > tail ? entry.id : tail), floor);

const selectPhase: typesModule.Dual3<
  compactionTypesModule.CompactionRuntime,
  compactionTypesModule.CompactionInput,
  chordTypes.Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: compactionTypesModule.CompactionRuntime,
    input: compactionTypesModule.CompactionInput,
    context: chordTypes.Context,
  ) {
    const { conversationId } = runtime;
    const agent = yield* Effect.promise(() => runtime.agent(context));
    const settings = runtime.settings;
    const ref = agent.model;
    const model =
      ref === undefined ? undefined : runtime.models.getModel(ref.provider, ref.modelId);
    if (ref === undefined || model === undefined)
      return yield* compactionPlace.failNoModel(runtime, ref, context);
    const policy = settings.compaction;
    const view = yield* Effect.promise(() => runtime.context(conversationId, context));
    const cut = selectCut(view, policy.keepRecentTokens);
    if (cut === undefined) return yield* compactionPlace.complete(runtime, context);
    const firstKept = view.entries[cut]!.id;
    const { reason, instructions } = input;
    const compaction = {
      entries: view.entries.slice(0, cut),
      firstKept,
      messages: summarizedMessages(view, cut),
      reason,
      ...(instructions === undefined ? {} : { instructions }),
    };
    const decision = yield* askHooks(runtime, compaction, context);
    if (decision !== undefined && "decline" in decision)
      return yield* compactionPlace.complete(runtime, context);
    if (decision !== undefined)
      return yield* compactionPlace.place(runtime, firstKept, decision.summary, context);
    const request: compactionTypesModule.SummaryRequest = {
      attempt: 1,
      firstKept,
      maxTokens: summaryMaxTokens(policy.reserveTokens, model.maxTokens),
      model: ref,
      streamOptions: settings.stream,
      tail: latestEntryId(view.entries, firstKept),
      thinkingLevel: agent.thinkingLevel,
    };
    yield* commitTask(
      runtime,
      (): Effect.Effect<compactionTypesModule.CompactionNext> =>
        Effect.succeed({
          checkpoint: { phase: "summarize", ...request },
          status: "running",
        }),
      context,
    );
  }),
);

const compactionStart = {
  createCompaction,
  selectPhase,
};

export default compactionStart;
