import type aiTypes from "@msa/ai/index.types";
import retryModule from "@msa/ai/utils/retry";
import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import generationRun from "./generation-run.ts";
import generationTypes from "./generation-types.ts";
import type generationTypesModule from "./generation-types.types.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";

const { isRetryableAssistantError, retryDelayMs } = retryModule;

const { DEFAULT_POLL_AFTER_MS } = generationTypes;
const { commitTask } = bridge;
const { LiveDoc, endRun } = liveModule;
const deferPoll = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  request: generationTypesModule.GenerationRequest,
  message: aiTypes.AssistantMessage & {
    deferred: NonNullable<aiTypes.AssistantMessage["deferred"]>;
  },
  context: chordTypes.Context,
) {
  const { attempt, compacted, model: ref, cutoff } = request;
  const handle = message.deferred;
  const pollAt = Math.max(
    runtime.now() + (handle.pollAfterMs ?? DEFAULT_POLL_AFTER_MS),
    request.pollAt === undefined ? Number.NEGATIVE_INFINITY : request.pollAt + 1,
  );
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        live.generation = { attempt, deferred: { pollAt } };
        const checkpoint = {
          attempt,
          phase: "poll",
          ...(compacted === undefined ? {} : { compacted }),
          cutoff,
          handle,
          model: ref,
          pollAt,
        } as const;
        return { checkpoint, status: "running" };
      }),
    context,
  );
});

const settleModelError = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  request: generationTypesModule.GenerationRequest,
  message: aiTypes.AssistantMessage,
  overflow: boolean,
  context: chordTypes.Context,
) {
  const { attempt, compacted } = request;
  const policy = runtime.settings.retry;
  const retry =
    message.stopReason === "error" &&
    !overflow &&
    isRetryableAssistantError(message) &&
    policy.enabled &&
    attempt <= policy.maxRetries;
  const until = retry ? runtime.now() + retryDelayMs(policy, attempt) : 0;
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        yield* generationRun.appendAssistant(tx, runtime.conversationId, message);
        if (retry) {
          live.generation = { attempt, retry: { at: until, error: message.errorMessage ?? "" } };
          const checkpoint = {
            attempt,
            phase: "retry",
            ...(compacted === undefined ? {} : { compacted }),
            until,
          } as const;
          return { checkpoint, status: "running" };
        }
        const text =
          message.errorMessage ?? `Model response ended with stop reason ${message.stopReason}`;
        endRun(tx, live, runtime.taskId, {
          detail: text,
          reason: "model_error",
          status: "unanswered",
        });
        return {
          outcome: {
            error: { detail: { reason: "model_error" }, message: text },
            status: "failed",
          },
          status: "terminal",
        };
      }),
    context,
  );
});

const generationRetry = {
  deferPoll,
  settleModelError,
};

export default generationRetry;
