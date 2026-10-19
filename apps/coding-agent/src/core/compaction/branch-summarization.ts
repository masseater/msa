import type { AgentMessage, StreamFn } from "@msa/agent-core";
import type { RetryCallbacks, RetryPolicy } from "@msa/ai";
import { contentText, normalizeContext } from "@msa/ai";
import type { Model, SimpleStreamOptions, Usage } from "@msa/ai/compat";
import { Effect, Function as Fn } from "effect";

import { convertToLlm } from "../messages.ts";
import {
  currentTimeMillis,
  fromPromise,
  platformRuntime,
  unwrapForeign,
} from "../platform/index.ts";
import type { SessionEntry } from "../session-manager.ts";
import { prepareBranchEntries } from "./branch-entries.ts";
import { completeSummarization, getSummarizationFailure } from "./compaction-summary.ts";
import {
  computeFileLists,
  formatFileOperations,
  SUMMARIZATION_SYSTEM_PROMPT,
  serializeConversation,
} from "./utils.ts";

export {
  type BranchPreparation,
  type BranchSummaryDetails,
  type CollectEntriesResult,
  collectEntriesForBranchSummary,
  prepareBranchEntries,
} from "./branch-entries.ts";
export type { FileOperations } from "./utils.ts";

export interface BranchSummaryResult {
  summary?: string;
  usage?: Usage | undefined;
  readFiles?: string[];
  modifiedFiles?: string[];
  aborted?: boolean;
  error?: string;
}

export interface GenerateBranchSummaryOptions {
  model: Model<any>;
  apiKey?: string | undefined;
  headers?: Record<string, string> | undefined;
  env?: Record<string, string> | undefined;
  signal: AbortSignal;
  customInstructions?: string | undefined;
  replaceInstructions?: boolean | undefined;
  reserveTokens?: number;
  streamFn?: StreamFn;
  retry?: RetryPolicy;
  callbacks?: RetryCallbacks;
}

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

function branchInstructions(options: GenerateBranchSummaryOptions): string {
  const { customInstructions, replaceInstructions } = options;
  const hasCustom = customInstructions !== undefined && customInstructions !== "";
  if (replaceInstructions === true && hasCustom) return customInstructions;
  return hasCustom
    ? `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`
    : BRANCH_SUMMARY_PROMPT;
}

function branchContext(messages: AgentMessage[], options: GenerateBranchSummaryOptions) {
  const conversationText = serializeConversation(convertToLlm(messages));
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${branchInstructions(options)}`;
  return normalizeContext({
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: promptText }],
        timestamp: currentTimeMillis(),
      },
    ],
  });
}

const branchSummary = (entries: SessionEntry[], options: GenerateBranchSummaryOptions) =>
  Effect.gen(function* () {
    const { model, apiKey, headers, env, signal, reserveTokens = 16384 } = options;
    const contextWindow = model.contextWindow > 0 ? model.contextWindow : 128000;
    const { messages, fileOps } = prepareBranchEntries(entries, contextWindow - reserveTokens);
    if (messages.length === 0) {
      return {
        summary: "No content to summarize",
      } satisfies BranchSummaryResult as BranchSummaryResult;
    }
    const context = branchContext(messages, options);
    const maxTokens = Math.min(
      4096,
      model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
    );
    const requestOptions: SimpleStreamOptions = { apiKey, headers, env, signal, maxTokens };
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
    if (response.stopReason === "aborted") return { aborted: true } as BranchSummaryResult;
    const failure = getSummarizationFailure(response, "Branch summarization");
    if (failure !== undefined && failure !== "") return { error: failure } as BranchSummaryResult;
    if (response.content.some((block) => block.type === "toolCall")) {
      return { error: "Branch summarization attempted to call a tool" } as BranchSummaryResult;
    }
    const { readFiles, modifiedFiles } = computeFileLists(fileOps);
    const summary =
      BRANCH_SUMMARY_PREAMBLE +
      contentText(response.content, "\n") +
      formatFileOperations(readFiles, modifiedFiles);
    return {
      summary,
      usage: response.usage,
      readFiles,
      modifiedFiles,
    } as BranchSummaryResult;
  });

export const generateBranchSummary: {
  (
    options: GenerateBranchSummaryOptions,
  ): (entries: SessionEntry[]) => Promise<BranchSummaryResult>;
  (entries: SessionEntry[], options: GenerateBranchSummaryOptions): Promise<BranchSummaryResult>;
} = Fn.dual(
  2,
  (entries: SessionEntry[], options: GenerateBranchSummaryOptions): Promise<BranchSummaryResult> =>
    platformRuntime.runPromise(unwrapForeign(branchSummary(entries, options))),
);
