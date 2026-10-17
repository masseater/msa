import type { AssistantMessage } from "@msa/ai";
import { isRetryableAssistantError, retryDelayMs } from "@msa/ai/utils/retry";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { commitTask } from "./bridge.ts";
import { appendAssistant } from "./generation-run.ts";
import {
  DEFAULT_POLL_AFTER_MS,
  type GenerationNext,
  type GenerationRequest,
  type GenerationRuntime,
} from "./generation-types.ts";
import { endRun, LiveDoc } from "./live.ts";
import type { Tx } from "./types.ts";

export const deferPoll = Effect.fn("deferPoll")(function* (
  runtime: GenerationRuntime,
  request: GenerationRequest,
  message: AssistantMessage & { deferred: NonNullable<AssistantMessage["deferred"]> },
  context: Context,
) {
  const { attempt, compacted, model: ref, cutoff } = request;
  const handle = message.deferred;
  const pollAt = Math.max(
    runtime.now() + (handle.pollAfterMs ?? DEFAULT_POLL_AFTER_MS),
    request.pollAt === undefined ? Number.NEGATIVE_INFINITY : request.pollAt + 1,
  );
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        live.generation = { attempt, deferred: { pollAt } };
        const checkpoint = {
          phase: "poll",
          attempt,
          ...(compacted === undefined ? {} : { compacted }),
          model: ref,
          cutoff,
          handle,
          pollAt,
        } as const;
        return { status: "running", checkpoint };
      }),
    context,
  );
});

export const settleModelError = Effect.fn("settleModelError")(function* (
  runtime: GenerationRuntime,
  request: GenerationRequest,
  message: AssistantMessage,
  overflow: boolean,
  context: Context,
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
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        yield* appendAssistant(tx, runtime.conversationId, message);
        if (retry) {
          live.generation = { attempt, retry: { at: until, error: message.errorMessage ?? "" } };
          const checkpoint = {
            phase: "retry",
            attempt,
            ...(compacted === undefined ? {} : { compacted }),
            until,
          } as const;
          return { status: "running", checkpoint };
        }
        const text =
          message.errorMessage ?? `Model response ended with stop reason ${message.stopReason}`;
        endRun(tx, live, runtime.taskId, {
          status: "unanswered",
          reason: "model_error",
          detail: text,
        });
        return {
          status: "terminal",
          outcome: {
            status: "failed",
            error: { message: text, detail: { reason: "model_error" } },
          },
        };
      }),
    context,
  );
});
