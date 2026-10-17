import type { AssistantMessage } from "@msa/ai";
import { isRetryableAssistantError, retryDelayMs } from "@msa/ai/utils/retry";
import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { commitTask } from "./bridge.ts";
import { placeSummary } from "./compaction-place.ts";
import type {
  CompactionNext,
  CompactionRuntime,
  CompactionTask,
  SummaryRequest,
} from "./compaction-types.ts";
import { compactionStatus, failCompactionStatus, LiveDoc } from "./live.ts";
import type { Dual3, Tx } from "./types.ts";
import { recordUsage } from "./usage.ts";

type SummaryTexts = { readonly summary: string | undefined; readonly failure: string };

const summaryChange =
  (
    runtime: CompactionRuntime,
    request: SummaryRequest,
    message: AssistantMessage,
    texts: SummaryTexts,
    until: number | undefined,
  ) =>
  (tx: Tx, current: CompactionTask): Effect.Effect<CompactionNext> =>
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
        return yield* placeSummary(
          tx,
          runtime,
          { current, live },
          { firstKept: request.firstKept, summary },
        );
      if (until !== undefined) {
        const status = compactionStatus(live, runtime.taskId);
        if (status !== undefined) status.retry = { at: until, error: message.errorMessage ?? "" };
        return { status: "running", checkpoint: { phase: "retry", ...request, until } };
      }
      failCompactionStatus(live, runtime.taskId, texts.failure);
      return {
        status: "terminal",
        outcome: {
          status: "failed",
          error: { message: texts.failure, detail: { reason: "model_error" } },
        },
      };
    });

export const settleSummary = Effect.fn("settleSummary")(function* (
  runtime: CompactionRuntime,
  request: SummaryRequest,
  message: AssistantMessage,
  texts: SummaryTexts,
  context: Context,
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

export const retryPhase: Dual3<
  CompactionRuntime,
  SummaryRequest & { readonly until: number },
  Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fn("compactionRetryPhase")(function* (
    runtime: CompactionRuntime,
    checkpoint: SummaryRequest & { readonly until: number },
    context: Context,
  ) {
    const { until, ...request } = checkpoint;
    yield* Effect.promise(() => runtime.sleep(until, context));
    const attempt = request.attempt + 1;
    yield* commitTask(
      runtime,
      (tx: Tx): Effect.Effect<CompactionNext> =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          const status = compactionStatus(live, runtime.taskId);
          if (status !== undefined) {
            status.attempt = attempt;
            delete status.retry;
          }
          return {
            status: "running",
            checkpoint: { phase: "summarize", ...request, attempt },
          };
        }),
      context,
    );
  }),
);
