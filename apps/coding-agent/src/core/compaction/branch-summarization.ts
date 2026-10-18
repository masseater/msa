import type { AgentMessage, StreamFn } from "@msa/agent-core";
import type { RetryCallbacks, RetryPolicy } from "@msa/ai";
import { contentText, normalizeContext } from "@msa/ai";
import type { Model, SimpleStreamOptions, Usage } from "@msa/ai/compat";

import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../messages.ts";
import type { ReadonlySessionManager, SessionEntry } from "../session-manager.ts";
import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.ts";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  SUMMARIZATION_SYSTEM_PROMPT,
  serializeConversation,
} from "./utils.ts";

export interface BranchSummaryResult {
  summary?: string;
  usage?: Usage | undefined;
  readFiles?: string[];
  modifiedFiles?: string[];
  aborted?: boolean;
  error?: string;
}

export interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

export type { FileOperations } from "./utils.ts";

export interface BranchPreparation {
  messages: AgentMessage[];
  fileOps: FileOperations;
  totalTokens: number;
}

export interface CollectEntriesResult {
  entries: SessionEntry[];
  commonAncestorId: string | null;
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

export function collectEntriesForBranchSummary(
  session: ReadonlySessionManager,
  oldLeafId: string | null,
  targetId: string,
): CollectEntriesResult {
  if (oldLeafId === null || oldLeafId === "") {
    return { entries: [], commonAncestorId: null };
  }

  const oldPath = new Set(session.getBranch(oldLeafId).map((e) => e.id));
  const targetPath = session.getBranch(targetId);

  let commonAncestorId: string | null = null;
  for (let i = targetPath.length - 1; i >= 0; i--) {
    const node = targetPath[i];
    if (node !== undefined && oldPath.has(node.id)) {
      commonAncestorId = node.id;
      break;
    }
  }

  const entries: SessionEntry[] = [];
  let current: string | null = oldLeafId;

  while (current !== null && current !== "" && current !== commonAncestorId) {
    const entry = session.getEntry(current);
    if (entry === undefined) break;
    entries.push(entry);
    current = entry.parentId;
  }

  entries.reverse();

  return { entries, commonAncestorId };
}

function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
  switch (entry.type) {
    case "message":
      if (entry.message.role === "toolResult") return undefined;
      return entry.message;

    case "custom_message":
      return createCustomMessage(
        entry.customType,
        entry.content,
        entry.display,
        entry.details,
        entry.timestamp,
      );

    case "branch_summary":
      return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);

    case "compaction":
      return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);

    case "thinking_level_change":
    case "model_change":
    case "custom":
    case "label":
    case "session_info":
    case "context_edit":
    case "usage":
      return undefined;
  }
}

export function prepareBranchEntries(
  entries: SessionEntry[],
  tokenBudget: number = 0,
): BranchPreparation {
  const messages: AgentMessage[] = [];
  const fileOps = createFileOps();
  let totalTokens = 0;

  for (const entry of entries) {
    if (entry.type === "branch_summary" && entry.fromHook !== true && entry.details) {
      const details = entry.details as BranchSummaryDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) {
          fileOps.edited.add(f);
        }
      }
    }
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const message = getMessageFromEntry(entry);
    if (message === undefined) continue;

    extractFileOpsFromMessage(message, fileOps);

    const tokens = estimateTokens(message);

    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      if (entry.type === "compaction" || entry.type === "branch_summary") {
        if (totalTokens < tokenBudget * 0.9) {
          messages.unshift(message);
          totalTokens += tokens;
        }
      }
      break;
    }

    messages.unshift(message);
    totalTokens += tokens;
  }

  return { messages, fileOps, totalTokens };
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

export async function generateBranchSummary(
  entries: SessionEntry[],
  options: GenerateBranchSummaryOptions,
): Promise<BranchSummaryResult> {
  const {
    model,
    apiKey,
    headers,
    env,
    signal,
    customInstructions,
    replaceInstructions,
    reserveTokens = 16384,
    streamFn,
    retry,
    callbacks,
  } = options;

  const contextWindow = model.contextWindow || 128000;
  const tokenBudget = contextWindow - reserveTokens;

  const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);

  if (messages.length === 0) {
    return { summary: "No content to summarize" };
  }

  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);

  let instructions: string;
  if (
    replaceInstructions === true &&
    customInstructions !== undefined &&
    customInstructions !== ""
  ) {
    instructions = customInstructions;
  } else if (customInstructions !== undefined && customInstructions !== "") {
    instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`;
  } else {
    instructions = BRANCH_SUMMARY_PROMPT;
  }
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;

  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const maxTokens = Math.min(
    4096,
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );

  const context = normalizeContext({
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: summarizationMessages,
  });
  const requestOptions: SimpleStreamOptions = { apiKey, headers, env, signal, maxTokens };
  const response = await completeSummarization(
    model,
    context,
    requestOptions,
    streamFn,
    retry,
    callbacks,
  );

  if (response.stopReason === "aborted") {
    return { aborted: true };
  }
  const failure = getSummarizationFailure(response, "Branch summarization");
  if (failure !== undefined && failure !== "") {
    return { error: failure };
  }
  if (response.content.some((block) => block.type === "toolCall")) {
    return { error: "Branch summarization attempted to call a tool" };
  }

  let summary = contentText(response.content, "\n");

  summary = BRANCH_SUMMARY_PREAMBLE + summary;

  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  return {
    summary: summary || "No summary generated",
    usage: response.usage,
    readFiles,
    modifiedFiles,
  };
}
