import type { AssistantMessage, ToolCall } from "@msa/ai";
import { isContextOverflow } from "@msa/ai/utils/overflow";
import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import generationAnswer from "./generation-answer.ts";
import generationOverflow from "./generation-overflow.ts";
import generationRetry from "./generation-retry.ts";
import generationTools from "./generation-tools.ts";
import type generationTypesModule from "./generation-types.types.ts";

const classify = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  request: generationTypesModule.GenerationRequest,
  message: AssistantMessage,
  context: chordTypes.Context,
) {
  runtime.signal.throwIfAborted();
  if (message.stopReason === "deferred" && message.deferred !== undefined)
    return yield* generationRetry.deferPoll(
      runtime,
      request,
      { ...message, deferred: message.deferred },
      context,
    );
  yield* Effect.promise(() =>
    runtime.hooks.each("afterResponse", (hook) => hook(message, runtime, context)),
  );
  const calls = message.content.filter(
    (content): content is ToolCall => content.type === "toolCall",
  );
  if (message.stopReason === "toolUse" && calls.length > 0)
    return yield* generationTools.startToolRound(runtime, request, message, calls, context);
  if (
    message.stopReason === "stop" ||
    message.stopReason === "length" ||
    message.stopReason === "toolUse"
  )
    return yield* generationAnswer.answer(runtime, message, context);
  const overflow = message.stopReason === "error" && isContextOverflow(message);
  if (overflow && request.compacted === undefined && runtime.settings.compaction.enabled) {
    const compacting = yield* generationOverflow.compactOverflow(
      runtime,
      request,
      message,
      context,
    );
    if (compacting) return;
  }
  yield* generationRetry.settleModelError(runtime, request, message, overflow, context);
});

const generationClassify = {
  classify,
};

export default generationClassify;
