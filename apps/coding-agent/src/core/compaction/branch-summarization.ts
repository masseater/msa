import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import { Effect, Function as Fn } from "effect";

import platform from "../platform/index.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import branchEntries from "./branch-entries.ts";
import type branchSummarizationTypes from "./branch-summarization.types.ts";
import branchSummaryPrompt from "./branch-summary-prompt.ts";
import summarizationCall from "./summarization-call.ts";
import utils from "./utils.ts";

const { prepareBranchEntries } = branchEntries;
const { computeFileLists, formatFileOperations } = utils;
const { branchContext } = branchSummaryPrompt;
const { fromPromise, unwrapForeign } = platform;
const { completeSummarization, getSummarizationFailure } = summarizationCall;

const { contentText } = ai;

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

type SummaryResponse = Awaited<ReturnType<typeof completeSummarization>>;

function branchSummaryResult(
  response: SummaryResponse,
  fileOps: ReturnType<typeof prepareBranchEntries>["fileOps"],
): branchSummarizationTypes.BranchSummaryResult {
  if (response.stopReason === "aborted") return { aborted: true };
  const failure = getSummarizationFailure(response, "Branch summarization");
  if (failure !== undefined && failure !== "") return { error: failure };
  if (response.content.some((block) => block.type === "toolCall")) {
    return {
      error: "Branch summarization attempted to call a tool",
    };
  }
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  const summary =
    BRANCH_SUMMARY_PREAMBLE +
    contentText(response.content, "\n") +
    formatFileOperations(readFiles, modifiedFiles);
  return {
    modifiedFiles,
    readFiles,
    summary,
    usage: response.usage,
  };
}

const branchSummary = (
  entries: sessionManagerTypes.SessionEntry[],
  options: branchSummarizationTypes.GenerateBranchSummaryOptions,
) =>
  Effect.gen(function* () {
    const { model, apiKey, headers, env, signal, reserveTokens = 16384 } = options;
    const contextWindow = model.contextWindow > 0 ? model.contextWindow : 128000;
    const { messages, fileOps } = prepareBranchEntries(entries, contextWindow - reserveTokens);
    if (messages.length === 0) {
      return {
        summary: "No content to summarize",
      } satisfies branchSummarizationTypes.BranchSummaryResult as branchSummarizationTypes.BranchSummaryResult;
    }
    const context = branchContext(messages, options);
    const requestOptions: compatTypes.SimpleStreamOptions = summaryRequestOptions(
      model,
      apiKey,
      env,
      headers,
      signal,
    );
    const response = yield* fromPromise(() =>
      completeSummarization(
        model,
        context,
        requestOptions,
        options.streamFn,
        options.retry,
        options.callbacks,
      ),
    );
    return branchSummaryResult(response, fileOps);
  });

const generateBranchSummary: {
  (
    options: branchSummarizationTypes.GenerateBranchSummaryOptions,
  ): (
    entries: sessionManagerTypes.SessionEntry[],
  ) => Promise<branchSummarizationTypes.BranchSummaryResult>;
  (
    entries: sessionManagerTypes.SessionEntry[],
    options: branchSummarizationTypes.GenerateBranchSummaryOptions,
  ): Promise<branchSummarizationTypes.BranchSummaryResult>;
} = Fn.dual(
  2,
  (
    entries: sessionManagerTypes.SessionEntry[],
    options: branchSummarizationTypes.GenerateBranchSummaryOptions,
  ): Promise<branchSummarizationTypes.BranchSummaryResult> =>
    Effect.runPromise(unwrapForeign(branchSummary(entries, options))),
);

const branchSummarization = {
  collectEntriesForBranchSummary: branchEntries.collectEntriesForBranchSummary,
  generateBranchSummary,
  prepareBranchEntries: branchEntries.prepareBranchEntries,
};

export default branchSummarization;

function summaryRequestOptions(
  model: compatTypes.Model<any>,
  apiKey: string | undefined,
  env: Record<string, string> | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
) {
  const maxTokens = Math.min(
    4096,
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  const requestOptions: compatTypes.SimpleStreamOptions = {
    apiKey,
    env,
    headers,
    maxTokens,
    signal,
  };
  return requestOptions;
}
