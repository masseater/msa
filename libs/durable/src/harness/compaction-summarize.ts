import type { Message, SimpleStreamOptions } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { failNoModel } from "./compaction-place.ts";
import {
  SUMMARIZATION_SYSTEM_PROMPT,
  summaryFailure,
  summaryPrompt,
  summaryText,
} from "./compaction-prompt.ts";
import { summarizedMessages } from "./compaction-select.ts";
import { settleSummary } from "./compaction-settle.ts";
import type { CompactionInput, CompactionRuntime, SummaryRequest } from "./compaction-types.ts";
import { ensureProviderSessionId } from "./provider.ts";
import type { ContextView, Dual4 } from "./types.ts";

const summaryMessages = (
  view: ContextView,
  cut: number,
  instructions: string | undefined,
  now: number,
): Message[] => [
  { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT, timestamp: now },
  {
    role: "user",
    content: [
      {
        type: "text",
        text: summaryPrompt(summarizedMessages(view, cut), instructions),
      },
    ],
    timestamp: now,
  },
];

const withoutDeferred = (
  options: SummaryRequest["streamOptions"],
): Omit<SummaryRequest["streamOptions"], "deferred"> => {
  const { deferred: _deferred, ...forwarded } = options;
  return forwarded;
};

const summaryOptions = Effect.fn("summaryOptions")(function* (
  runtime: CompactionRuntime,
  request: SummaryRequest,
  context: Context,
) {
  const { thinkingLevel, streamOptions, maxTokens } = request;
  const options: SimpleStreamOptions = {
    ...withoutDeferred(streamOptions),
    cacheRetention: "none",
    maxTokens,
    signal: runtime.signal,
    sessionId: yield* ensureProviderSessionId(runtime, context),
    ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
  };
  return options;
});

export const summarizePhase: Dual4<
  CompactionRuntime,
  SummaryRequest,
  CompactionInput,
  Context,
  Effect.Effect<void>
> = Function.dual(
  4,
  Effect.fn("summarizePhase")(function* (
    runtime: CompactionRuntime,
    request: SummaryRequest,
    input: CompactionInput,
    context: Context,
  ) {
    const { model: ref, tail, firstKept } = request;
    const model = runtime.models.getModel(ref.provider, ref.modelId);
    if (model === undefined) return yield* failNoModel(runtime, ref, context);
    const view = yield* Effect.promise(() =>
      runtime.context(runtime.conversationId, context, { at: tail }),
    );
    const cut = view.entries.findIndex((entry) => entry.id === firstKept);
    const messages = summaryMessages(view, cut, input.instructions, runtime.now());
    const options = yield* summaryOptions(runtime, request, context);
    const message = yield* Effect.promise(() =>
      runtime.models.completeSimple(model, { messages }, options),
    );
    runtime.signal.throwIfAborted();
    const texts = { summary: summaryText(message), failure: summaryFailure(message) };
    yield* settleSummary(runtime, request, message, texts, context);
  }),
);
