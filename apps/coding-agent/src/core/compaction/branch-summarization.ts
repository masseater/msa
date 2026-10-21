import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import { Effect, Function as Fn } from "effect";

import messagesModule from "../messages.ts";
import platform from "../platform/index.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import branchEntries from "./branch-entries.ts";
import type branchSummarizationTypes from "./branch-summarization.types.ts";
import compactionSummary from "./compaction-summary.ts";
import utils from "./utils.ts";

const { prepareBranchEntries } = branchEntries;
const {
  SUMMARIZATION_SYSTEM_PROMPT,
  computeFileLists,
  formatFileOperations,
  serializeConversation,
} = utils;
const { convertToLlm } = messagesModule;
const { currentTimeMillis, fromPromise, unwrapForeign } = platform;
const { completeSummarization, getSummarizationFailure } = compactionSummary;

const { contentText, normalizeContext } = ai;

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

function branchInstructions(
  options: branchSummarizationTypes.GenerateBranchSummaryOptions,
): string {
  const { customInstructions, replaceInstructions } = options;
  const hasCustom = customInstructions !== undefined && customInstructions !== "";
  if (replaceInstructions === true && hasCustom) return customInstructions;
  return hasCustom
    ? `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`
    : BRANCH_SUMMARY_PROMPT;
}

function branchContext(
  messages: agentTypes.AgentMessage[],
  options: branchSummarizationTypes.GenerateBranchSummaryOptions,
) {
  const conversationText = serializeConversation(convertToLlm(messages));
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${branchInstructions(options)}`;
  return normalizeContext({
    messages: [
      {
        content: [{ text: promptText, type: "text" as const }],
        role: "user" as const,
        timestamp: currentTimeMillis(),
      },
    ],
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
  });
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
    if (response.stopReason === "aborted")
      return { aborted: true } as branchSummarizationTypes.BranchSummaryResult;
    const failure = getSummarizationFailure(response, "Branch summarization");
    if (failure !== undefined && failure !== "")
      return { error: failure } as branchSummarizationTypes.BranchSummaryResult;
    if (response.content.some((block) => block.type === "toolCall")) {
      return {
        error: "Branch summarization attempted to call a tool",
      } as branchSummarizationTypes.BranchSummaryResult;
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
    } as branchSummarizationTypes.BranchSummaryResult;
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
