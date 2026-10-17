import type { AssistantMessage, ToolCall } from "@msa/ai";
import { isContextOverflow } from "@msa/ai/utils/overflow";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { answer } from "./generation-answer.ts";
import { compactOverflow } from "./generation-overflow.ts";
import { deferPoll, settleModelError } from "./generation-retry.ts";
import { startToolRound } from "./generation-tools.ts";
import type { GenerationRequest, GenerationRuntime } from "./generation-types.ts";

export const classify = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  request: GenerationRequest,
  message: AssistantMessage,
  context: Context,
) {
  runtime.signal.throwIfAborted();
  if (message.stopReason === "deferred" && message.deferred !== undefined)
    return yield* deferPoll(runtime, request, { ...message, deferred: message.deferred }, context);
  yield* Effect.promise(() =>
    runtime.hooks.each("afterResponse", (hook) => hook(message, runtime, context)),
  );
  const calls = message.content.filter(
    (content): content is ToolCall => content.type === "toolCall",
  );
  if (message.stopReason === "toolUse" && calls.length > 0)
    return yield* startToolRound(runtime, request, message, calls, context);
  if (
    message.stopReason === "stop" ||
    message.stopReason === "length" ||
    message.stopReason === "toolUse"
  )
    return yield* answer(runtime, message, context);
  const overflow = message.stopReason === "error" && isContextOverflow(message);
  if (overflow && request.compacted === undefined && runtime.settings.compaction.enabled) {
    const compacting = yield* compactOverflow(runtime, request, message, context);
    if (compacting) return;
  }
  yield* settleModelError(runtime, request, message, overflow, context);
});
