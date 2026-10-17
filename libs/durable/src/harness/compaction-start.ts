import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { commitTask, eachHook, hookResult } from "./bridge.ts";
import { complete, failNoModel, place } from "./compaction-place.ts";
import { selectCut, summarizedMessages } from "./compaction-select.ts";
import type {
  CompactionInput,
  CompactionNext,
  CompactionRuntime,
  CompactionTaskId,
  SummaryRequest,
} from "./compaction-types.ts";
import { CompactionTask } from "./compaction.ts";
import { addCompactionStatus, LiveDoc } from "./live.ts";
import type { CompactionHooks, ConversationId, Dual3, TaskId, Tx } from "./types.ts";

export const createCompaction: {
  (
    conversationId: ConversationId,
    input: CompactionInput,
    owner?: TaskId,
  ): (tx: Tx) => Effect.Effect<CompactionTaskId>;
  (
    tx: Tx,
    conversationId: ConversationId,
    input: CompactionInput,
    owner?: TaskId,
  ): Effect.Effect<CompactionTaskId>;
} = Function.dual(
  (args: IArguments) => typeof args[0] !== "number",
  Effect.fnUntraced(function* (
    tx: Tx,
    conversationId: ConversationId,
    input: CompactionInput,
    owner?: TaskId,
  ) {
    const ownership =
      owner === undefined
        ? ({ kind: "conversation" } as const)
        : { kind: "task" as const, taskId: owner };
    const background = owner === undefined && input.reason !== "manual";
    const taskId = yield* Effect.promise(() =>
      tx.createTask(CompactionTask, input, { ownership, conversationId, background }),
    );
    const status = { taskId, reason: input.reason, blocking: owner !== undefined, attempt: 1 };
    const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
    addCompactionStatus(live, status);
    return taskId;
  }),
);

type Decision = { readonly decline: true } | { readonly summary: string } | undefined;

type CompactionRequest = Parameters<NonNullable<CompactionHooks["beforeCompact"]>>[0];

const askHooks = Effect.fnUntraced(function* (
  runtime: CompactionRuntime,
  compaction: CompactionRequest,
  context: Context,
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

export const selectPhase: Dual3<
  CompactionRuntime,
  CompactionInput,
  Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: CompactionRuntime,
    input: CompactionInput,
    context: Context,
  ) {
    const { conversationId } = runtime;
    const agent = yield* Effect.promise(() => runtime.agent(context));
    const settings = runtime.settings;
    const ref = agent.model;
    const model =
      ref === undefined ? undefined : runtime.models.getModel(ref.provider, ref.modelId);
    if (ref === undefined || model === undefined) return yield* failNoModel(runtime, ref, context);
    const policy = settings.compaction;
    const view = yield* Effect.promise(() => runtime.context(conversationId, context));
    const cut = selectCut(view, policy.keepRecentTokens);
    if (cut === undefined) return yield* complete(runtime, context);
    const firstKept = view.entries[cut]!.id;
    const { reason, instructions } = input;
    const compaction = {
      reason,
      entries: view.entries.slice(0, cut),
      messages: summarizedMessages(view, cut),
      firstKept,
      ...(instructions === undefined ? {} : { instructions }),
    };
    const decision = yield* askHooks(runtime, compaction, context);
    if (decision !== undefined && "decline" in decision) return yield* complete(runtime, context);
    if (decision !== undefined) return yield* place(runtime, firstKept, decision.summary, context);
    const request: SummaryRequest = {
      attempt: 1,
      model: ref,
      thinkingLevel: agent.thinkingLevel,
      streamOptions: settings.stream,
      maxTokens: Math.min(
        Math.floor(0.8 * policy.reserveTokens),
        model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
      ),
      tail: view.entries.reduce((tail, entry) => (entry.id > tail ? entry.id : tail), firstKept),
      firstKept,
    };
    yield* commitTask(
      runtime,
      (): Effect.Effect<CompactionNext> =>
        Effect.succeed({
          status: "running",
          checkpoint: { phase: "summarize", ...request },
        }),
      context,
    );
  }),
);
