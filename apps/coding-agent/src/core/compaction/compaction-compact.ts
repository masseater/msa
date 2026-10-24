import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect, Function as Fn } from "effect";

import platform from "../platform/index.ts";
import usageTotals from "../usage-totals.ts";
import compactionSummary from "./compaction-summary.ts";
import type compactionTypesTypes from "./compaction-types.types.ts";
import utils from "./utils.ts";

const { generateTurnPrefixSummary, summaryWithUsage } = compactionSummary;
const { combineUsage } = usageTotals;
const { computeFileLists, formatFileOperations } = utils;
const { ToolFailure, unwrapForeign } = platform;

type CompactRest = [
  model: compatTypes.Model<any>,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: agentTypes.ThinkingLevel,
  streamFn?: agentTypes.StreamFn,
  env?: Record<string, string>,
  retry?: aiTypes.RetryPolicy,
  callbacks?: aiTypes.RetryCallbacks,
  sessionId?: string,
];

interface SplitTurnInput {
  preparation: compactionTypesTypes.CompactionPreparation;
  rest: CompactRest;
  summarize: (messages: agentTypes.AgentMessage[]) => ReturnType<typeof summaryWithUsage>;
}

const summarizeSplitTurn = ({ preparation, rest, summarize }: SplitTurnInput) =>
  Effect.gen(function* () {
    const [
      model,
      apiKey,
      headers,
      ,
      signal,
      thinkingLevel,
      streamFn,
      env,
      retry,
      callbacks,
      sessionId,
    ] = rest;
    const { messagesToSummarize, turnPrefixMessages, previousSummary, settings } = preparation;
    let historyText = previousSummary ?? "No prior history.";
    let historyUsage: compatTypes.Usage | undefined;
    if (messagesToSummarize.length > 0) {
      const historyResult = yield* summarize(messagesToSummarize);
      historyText = historyResult.text;
      historyUsage = historyResult.usage;
    }
    const turnPrefixResult = yield* generateTurnPrefixSummary({
      apiKey,
      callbacks,
      env,
      headers,
      messages: turnPrefixMessages,
      model,
      reserveTokens: settings.reserveTokens,
      retry,
      sessionId,
      signal,
      streamFn,
      thinkingLevel,
    });
    return {
      text: `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.text}`,
      usage:
        historyUsage === undefined
          ? turnPrefixResult.usage
          : combineUsage(historyUsage, turnPrefixResult.usage),
    };
  });

const summarizerFor = (
  preparation: compactionTypesTypes.CompactionPreparation,
  rest: CompactRest,
) => {
  const [
    model,
    apiKey,
    headers,
    customInstructions,
    signal,
    thinkingLevel,
    streamFn,
    env,
    retry,
    callbacks,
    sessionId,
  ] = rest;
  return (messages: agentTypes.AgentMessage[]) =>
    summaryWithUsage(
      messages,
      model,
      preparation.settings.reserveTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      preparation.previousSummary,
      thinkingLevel,
      streamFn,
      env,
      retry,
      callbacks,
      sessionId,
    );
};

const compactEffect = Effect.fn("compact")(function* (
  preparation: compactionTypesTypes.CompactionPreparation,
  ...rest: CompactRest
) {
  const summarize = summarizerFor(preparation, rest);
  const { text, usage } =
    preparation.isSplitTurn && preparation.turnPrefixMessages.length > 0
      ? yield* summarizeSplitTurn({ preparation, rest, summarize })
      : yield* summarize(preparation.messagesToSummarize);

  const { readFiles, modifiedFiles } = computeFileLists(preparation.fileOps);
  if (preparation.firstKeptEntryId === "") {
    return yield* ToolFailure.make({
      message: "First kept entry has no UUID - session may need migration",
    });
  }
  const result: compactionTypesTypes.CompactionResult = {
    details: { modifiedFiles, readFiles } as compactionTypesTypes.CompactionDetails,
    firstKeptEntryId: preparation.firstKeptEntryId,
    summary: text + formatFileOperations(readFiles, modifiedFiles),
    tokensBefore: preparation.tokensBefore,
    usage,
  };
  return result;
});

const compactImpl = (
  preparation: compactionTypesTypes.CompactionPreparation,
  ...rest: CompactRest
): Promise<compactionTypesTypes.CompactionResult> =>
  Effect.runPromise(unwrapForeign(compactEffect(preparation, ...rest)));

const compact: {
  (
    ...rest: CompactRest
  ): (
    preparation: compactionTypesTypes.CompactionPreparation,
  ) => Promise<compactionTypesTypes.CompactionResult>;
  (
    preparation: compactionTypesTypes.CompactionPreparation,
    ...rest: CompactRest
  ): Promise<compactionTypesTypes.CompactionResult>;
} = Fn.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "firstKeptEntryId" in args[0],
  compactImpl,
);

const compactionCompact = {
  compact,
};

export default compactionCompact;
