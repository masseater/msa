import type { AgentMessage } from "@msa/agent-core";
import { getCurrentSystemMessage } from "@msa/ai";
import type { AssistantMessage, SystemMessage, Usage } from "@msa/ai/compat";
import { Function as Fn } from "effect";

import type { SessionEntry, SessionProjection } from "../session-manager.ts";
import type { CompactionSettings } from "./compaction-types.ts";

export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens > 0
    ? usage.totalTokens
    : usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg as AssistantMessage;
    if (
      assistantMsg.stopReason !== "aborted" &&
      assistantMsg.stopReason !== "error" &&
      assistantMsg.usage !== undefined &&
      calculateContextTokens(assistantMsg.usage) > 0
    ) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

export function getLastAssistantUsage(entries: SessionEntry[]): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "message") {
      const usage = getAssistantUsage(entry.message);
      if (usage !== undefined) return usage;
    }
  }
  return undefined;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[],
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) continue;
    const usage = getAssistantUsage(message);
    if (usage !== undefined) return { usage, index: i };
  }
  return undefined;
}

export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (usageInfo === undefined) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (const message of messages.slice(usageInfo.index + 1)) {
    trailingTokens += estimateTokens(message);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

const estimateProjectedContextTokensImpl = (
  projection: SessionProjection,
  branchEntries: SessionEntry[],
): ContextUsageEstimate => {
  const estimate = estimateContextTokens(projection.messages);
  if (estimate.lastUsageIndex !== null) {
    let projectedMessageIndex = 0;
    let usageEntryId: string | undefined;
    for (const entry of projection.entries) {
      const nextMessageIndex = projectedMessageIndex + entry.messages.length;
      if (estimate.lastUsageIndex < nextMessageIndex) {
        usageEntryId = entry.sourceEntry.id;
        break;
      }
      projectedMessageIndex = nextMessageIndex;
    }

    const usageEntryIndex =
      usageEntryId !== undefined && usageEntryId !== ""
        ? branchEntries.findIndex((entry) => entry.id === usageEntryId)
        : -1;
    let latestInvalidatingEntryIndex = -1;
    for (let i = branchEntries.length - 1; i >= 0; i--) {
      const entry = branchEntries[i];
      if (entry?.type === "context_edit" || entry?.type === "compaction") {
        latestInvalidatingEntryIndex = i;
        break;
      }
    }
    if (usageEntryIndex > latestInvalidatingEntryIndex) return estimate;
  }

  const currentSystem = getCurrentSystemMessage(projection.messages);
  let tokens = currentSystem === undefined ? 0 : estimateTokens(currentSystem);
  for (const message of projection.messages) {
    if (message.role !== "system") tokens += estimateTokens(message);
  }
  return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
};

export const estimateProjectedContextTokens: {
  (branchEntries: SessionEntry[]): (projection: SessionProjection) => ContextUsageEstimate;
  (projection: SessionProjection, branchEntries: SessionEntry[]): ContextUsageEstimate;
} = Fn.dual(2, estimateProjectedContextTokensImpl);

const shouldCompactImpl = (
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean => {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
};

export const shouldCompact: {
  (contextWindow: number, settings: CompactionSettings): (contextTokens: number) => boolean;
  (contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean;
} = Fn.dual(3, shouldCompactImpl);

const ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextAndImageContentChars(
  content: string | Array<{ type: string; text?: string }>,
): number {
  if (typeof content === "string") {
    return content.length;
  }

  let chars = 0;
  for (const block of content) {
    if (block.type === "text" && block.text !== undefined && block.text !== "") {
      chars += block.text.length;
    } else if (block.type === "image") {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "system": {
      const system = message as SystemMessage;
      chars = estimateTextAndImageContentChars(system.content);
      if (system.sections !== undefined) {
        for (const section of Object.values(system.sections)) {
          if (section !== null && section !== "") chars += section.length;
        }
      }
      if (system.toolsAdded !== undefined) chars += JSON.stringify(system.toolsAdded).length;
      return Math.ceil(chars / 4);
    }
    case "user": {
      chars = estimateTextAndImageContentChars(
        (message as { content: string | Array<{ type: string; text?: string }> }).content,
      );
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + JSON.stringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "custom":
    case "toolResult": {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    case "bashExecution": {
      chars = message.command.length + message.output.length;
      return Math.ceil(chars / 4);
    }
    case "branchSummary":
    case "compactionSummary": {
      chars = message.summary.length;
      return Math.ceil(chars / 4);
    }
  }
}
