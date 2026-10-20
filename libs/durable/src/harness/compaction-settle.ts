import type { AssistantMessage } from "@msa/ai";
import { isRetryableAssistantError, retryDelayMs } from "@msa/ai/utils/retry";
import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import bridge from "./bridge.ts";
import compactionPlace from "./compaction-place.ts";
import type compactionTypesModule from "./compaction-types.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";

const { recordUsage } = usageModule;
const { LiveDoc, compactionStatus, failCompactionStatus } = liveModule;
const { commitTask } = bridge;

type SummaryTexts = { readonly summary: string | undefined; readonly failure: string };

const summaryChange =
  (
    runtime: compactionTypesModule.CompactionRuntime,
    request: compactionTypesModule.SummaryRequest,
    message: AssistantMessage,
    texts: SummaryTexts,
    until: number | undefined,
  ) =>
  (
    tx: typesModule.Tx,
    current: compactionTypesModule.CompactionTask,
  ): Effect.Effect<compactionTypesModule.CompactionNext> =>
    Effect.gen(function* () {
      yield* recordUsage(
        tx,
        runtime.conversationId,
        "models",
        `${message.provider}/${message.model}`,
        message.usage,
      );
      const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
      const { summary } = texts;
      if (summary !== undefined)
        return yield* compactionPlace.placeSummary(
          tx,
          runtime,
          { current, live },
          { firstKept: request.firstKept, summary },
        );
      if (until !== undefined) {
        const status = compactionStatus(live, runtime.taskId);
        if (status !== undefined) status.retry = { at: until, error: message.errorMessage ?? "" };
        return { checkpoint: { phase: "retry", ...request, until }, status: "running" };
      }
      failCompactionStatus(live, runtime.taskId, texts.failure);
      return {
        outcome: {
          error: { detail: { reason: "model_error" }, message: texts.failure },
          status: "failed",
        },
        status: "terminal",
      };
    });

const settleSummary = Effect.fnUntraced(function* (
  runtime: compactionTypesModule.CompactionRuntime,
  request: compactionTypesModule.SummaryRequest,
  message: AssistantMessage,
  texts: SummaryTexts,
  context: chordTypes.Context,
) {
  const policy = runtime.settings.retry;
  const retry =
    message.stopReason === "error" &&
    isRetryableAssistantError(message) &&
    policy.enabled &&
    request.attempt <= policy.maxRetries;
  const until = retry ? runtime.now() + retryDelayMs(policy, request.attempt) : undefined;
  yield* commitTask(runtime, summaryChange(runtime, request, message, texts, until), context);
});

const retryPhase: typesModule.Dual3<
  compactionTypesModule.CompactionRuntime,
  compactionTypesModule.SummaryRequest & { readonly until: number },
  chordTypes.Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: compactionTypesModule.CompactionRuntime,
    checkpoint: compactionTypesModule.SummaryRequest & { readonly until: number },
    context: chordTypes.Context,
  ) {
    const { until, ...request } = checkpoint;
    yield* Effect.promise(() => runtime.sleep(until, context));
    const attempt = request.attempt + 1;
    yield* commitTask(
      runtime,
      (tx: typesModule.Tx): Effect.Effect<compactionTypesModule.CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          const status = compactionStatus(live, runtime.taskId);
          if (status !== undefined) {
            status.attempt = attempt;
            delete status.retry;
          }
          return {
            checkpoint: { phase: "summarize", ...request, attempt },
            status: "running",
          };
        }),
      context,
    );
  }),
);

const compactionSettle = {
  retryPhase,
  settleSummary,
};

export default compactionSettle;
