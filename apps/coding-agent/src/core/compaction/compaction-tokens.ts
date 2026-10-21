import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import { Function as Fn } from "effect";

import type sessionManagerTypes from "../session-manager.types.ts";
import type compactionTokensTypes from "./compaction-tokens.types.ts";
import type compactionTypesTypes from "./compaction-types.types.ts";

const { getCurrentSystemMessage } = ai;

function calculateContextTokens(usage: compatTypes.Usage): number {
  return usage.totalTokens > 0
    ? usage.totalTokens
    : usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function getAssistantUsage(msg: agentTypes.AgentMessage): compatTypes.Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg as compatTypes.AssistantMessage;
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

function getLastAssistantUsage(
  entries: sessionManagerTypes.SessionEntry[],
): compatTypes.Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "message") {
      const usage = getAssistantUsage(entry.message);
      if (usage !== undefined) return usage;
    }
  }
  return undefined;
}

function getLastAssistantUsageInfo(
  messages: agentTypes.AgentMessage[],
): { usage: compatTypes.Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) continue;
    const usage = getAssistantUsage(message);
    if (usage !== undefined) return { index: i, usage };
  }
  return undefined;
}

function estimateContextTokens(
  messages: agentTypes.AgentMessage[],
): compactionTokensTypes.ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (usageInfo === undefined) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      lastUsageIndex: null,
      tokens: estimated,
      trailingTokens: estimated,
      usageTokens: 0,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (const message of messages.slice(usageInfo.index + 1)) {
    trailingTokens += estimateTokens(message);
  }

  return {
    lastUsageIndex: usageInfo.index,
    tokens: usageTokens + trailingTokens,
    trailingTokens,
    usageTokens,
  };
}

const estimateProjectedContextTokensImpl = (
  projection: sessionManagerTypes.SessionProjection,
  branchEntries: sessionManagerTypes.SessionEntry[],
): compactionTokensTypes.ContextUsageEstimate => {
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
  return { lastUsageIndex: null, tokens, trailingTokens: tokens, usageTokens: 0 };
};

const estimateProjectedContextTokens: {
  (
    branchEntries: sessionManagerTypes.SessionEntry[],
  ): (
    projection: sessionManagerTypes.SessionProjection,
  ) => compactionTokensTypes.ContextUsageEstimate;
  (
    projection: sessionManagerTypes.SessionProjection,
    branchEntries: sessionManagerTypes.SessionEntry[],
  ): compactionTokensTypes.ContextUsageEstimate;
} = Fn.dual(2, estimateProjectedContextTokensImpl);

const shouldCompactImpl = (
  contextTokens: number,
  contextWindow: number,
  settings: compactionTypesTypes.CompactionSettings,
): boolean => {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
};

const shouldCompact: {
  (
    contextWindow: number,
    settings: compactionTypesTypes.CompactionSettings,
  ): (contextTokens: number) => boolean;
  (
    contextTokens: number,
    contextWindow: number,
    settings: compactionTypesTypes.CompactionSettings,
  ): boolean;
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

function estimateTokens(message: agentTypes.AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "system": {
      const system = message as compatTypes.SystemMessage;
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
      const assistant = message as compatTypes.AssistantMessage;
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

const compactionTokens = {
  calculateContextTokens,
  estimateContextTokens,
  estimateProjectedContextTokens,
  estimateTokens,
  getLastAssistantUsage,
  shouldCompact,
};

export default compactionTokens;
