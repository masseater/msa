import type { Message, SimpleStreamOptions } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import compactionPlace from "./compaction-place.ts";
import compactionPrompt from "./compaction-prompt.ts";
import compactionSelect from "./compaction-select.ts";
import compactionSettle from "./compaction-settle.ts";
import type compactionTypesModule from "./compaction-types.ts";
import providerModule from "./provider.ts";
import type typesModule from "./types.types.ts";

const { SUMMARIZATION_SYSTEM_PROMPT, summaryFailure, summaryPrompt, summaryText } =
  compactionPrompt;
const { summarizedMessages } = compactionSelect;
const { ensureProviderSessionId } = providerModule;
const summaryMessages = (
  view: typesModule.ContextView,
  cut: number,
  instructions: string | undefined,
  now: number,
): Message[] => [
  { content: SUMMARIZATION_SYSTEM_PROMPT, role: "system", timestamp: now },
  {
    content: [
      {
        text: summaryPrompt(summarizedMessages(view, cut), instructions),
        type: "text",
      },
    ],
    role: "user",
    timestamp: now,
  },
];

const withoutDeferred = (
  options: compactionTypesModule.SummaryRequest["streamOptions"],
): Omit<compactionTypesModule.SummaryRequest["streamOptions"], "deferred"> => {
  const { deferred: _deferred, ...forwarded } = options;
  return forwarded;
};

const summaryOptions = Effect.fnUntraced(function* (
  runtime: compactionTypesModule.CompactionRuntime,
  request: compactionTypesModule.SummaryRequest,
  context: chordTypes.Context,
) {
  const { thinkingLevel, streamOptions, maxTokens } = request;
  const options: SimpleStreamOptions = {
    ...withoutDeferred(streamOptions),
    cacheRetention: "none",
    maxTokens,
    sessionId: yield* ensureProviderSessionId(runtime, context),
    signal: runtime.signal,
    ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
  };
  return options;
});

const summarizePhase: typesModule.Dual4<
  compactionTypesModule.CompactionRuntime,
  compactionTypesModule.SummaryRequest,
  compactionTypesModule.CompactionInput,
  chordTypes.Context,
  Effect.Effect<void>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    runtime: compactionTypesModule.CompactionRuntime,
    request: compactionTypesModule.SummaryRequest,
    input: compactionTypesModule.CompactionInput,
    context: chordTypes.Context,
  ) {
    const { model: ref, tail, firstKept } = request;
    const model = runtime.models.getModel(ref.provider, ref.modelId);
    if (model === undefined) return yield* compactionPlace.failNoModel(runtime, ref, context);
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
    const texts = { failure: summaryFailure(message), summary: summaryText(message) };
    yield* compactionSettle.settleSummary(runtime, request, message, texts, context);
  }),
);

const compactionSummarize = {
  summarizePhase,
};

export default compactionSummarize;
