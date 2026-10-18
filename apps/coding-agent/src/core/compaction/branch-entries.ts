import type { AgentMessage } from "@msa/agent-core";
import { Function as Fn } from "effect";

import {
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../messages.ts";
import type { ReadonlySessionManager, SessionEntry } from "../session-manager.ts";
import { estimateTokens } from "./compaction-tokens.ts";
import { createFileOps, extractFileOpsFromMessage, type FileOperations } from "./utils.ts";

export interface BranchPreparation {
  messages: AgentMessage[];
  fileOps: FileOperations;
  totalTokens: number;
}

export interface CollectEntriesResult {
  entries: SessionEntry[];
  commonAncestorId: string | null;
}

export interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

const collectEntriesImpl = (
  session: ReadonlySessionManager,
  oldLeafId: string | null,
  targetId: string,
): CollectEntriesResult => {
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
};

export const collectEntriesForBranchSummary: {
  (
    oldLeafId: string | null,
    targetId: string,
  ): (session: ReadonlySessionManager) => CollectEntriesResult;
  (
    session: ReadonlySessionManager,
    oldLeafId: string | null,
    targetId: string,
  ): CollectEntriesResult;
} = Fn.dual(3, collectEntriesImpl);

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

function collectPreviousFileOps(entries: SessionEntry[], fileOps: FileOperations): void {
  for (const entry of entries) {
    if (
      entry.type === "branch_summary" &&
      entry.fromHook !== true &&
      typeof entry.details === "object" &&
      entry.details !== null
    ) {
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
}

const prepareBranchEntriesImpl = (
  entries: SessionEntry[],
  tokenBudget: number = 0,
): BranchPreparation => {
  const messages: AgentMessage[] = [];
  const fileOps = createFileOps();
  let totalTokens = 0;

  collectPreviousFileOps(entries, fileOps);

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
};

export const prepareBranchEntries: {
  (tokenBudget?: number): (entries: SessionEntry[]) => BranchPreparation;
  (entries: SessionEntry[], tokenBudget?: number): BranchPreparation;
} = Fn.dual((args) => Array.isArray(args[0]), prepareBranchEntriesImpl);
