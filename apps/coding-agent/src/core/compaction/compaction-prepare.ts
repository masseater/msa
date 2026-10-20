import type agentTypes from "@msa/agent-core/index.types";
import { Function as Fn } from "effect";

import {
  type CompactionEntry,
  type ProjectedSessionEntry,
  type SessionEntry,
  buildSessionProjection,
} from "../session-manager.ts";
import { findProjectedCutPoint } from "./compaction-cut.ts";
import { estimateProjectedContextTokens } from "./compaction-tokens.ts";
import type {
  CompactionDetails,
  CompactionPreparation,
  CompactionSettings,
  CutPointResult,
} from "./compaction-types.ts";
import { type FileOperations, createFileOps, extractFileOpsFromMessage } from "./utils.ts";

function extractFileOperations(
  messages: agentTypes.AgentMessage[],
  entries: SessionEntry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps();

  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
    if (
      prevCompaction.fromHook !== true &&
      typeof prevCompaction.details === "object" &&
      prevCompaction.details !== null
    ) {
      const details = prevCompaction.details as CompactionDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) fileOps.edited.add(f);
      }
    }
  }

  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }

  return fileOps;
}

function getMessagesFromProjectedEntryForCompaction(
  entry: ProjectedSessionEntry,
): agentTypes.AgentMessage[] {
  if (entry.sourceEntry.type === "compaction") return [];
  return entry.messages.filter((message) => message.role !== "system");
}

function findBoundary(projectedEntries: ProjectedSessionEntry[]) {
  const prevCompactionIndex = projectedEntries.findIndex(
    (entry) => entry.sourceEntry.type === "compaction" && entry.messages.length > 0,
  );
  const prevCompaction = projectedEntries[prevCompactionIndex];
  return {
    boundaryStart: prevCompaction === undefined ? 0 : prevCompactionIndex + 1,
    prevCompactionIndex,
    previousSummary:
      prevCompaction === undefined
        ? undefined
        : (prevCompaction.sourceEntry as CompactionEntry).summary,
  };
}

function collectMessages(
  projectedEntries: ProjectedSessionEntry[],
  boundaryStart: number,
  cutPoint: CutPointResult,
) {
  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  return {
    messagesToSummarize: projectedEntries
      .slice(boundaryStart, historyEnd)
      .flatMap(getMessagesFromProjectedEntryForCompaction),
    turnPrefixMessages: cutPoint.isSplitTurn
      ? projectedEntries
          .slice(cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
          .flatMap(getMessagesFromProjectedEntryForCompaction)
      : [],
  };
}

const prepareCompactionImpl = (
  pathEntries: SessionEntry[],
  settings: CompactionSettings,
): CompactionPreparation | undefined => {
  if (pathEntries.at(-1)?.type === "compaction") {
    return undefined;
  }

  const projection = buildSessionProjection(pathEntries);
  const projectedEntries = projection.entries;
  const { prevCompactionIndex, previousSummary, boundaryStart } = findBoundary(projectedEntries);
  const cutPoint = findProjectedCutPoint({
    endIndex: projectedEntries.length,
    entries: projectedEntries,
    keepRecentTokens: settings.keepRecentTokens,
    startIndex: boundaryStart,
  });

  const firstKeptEntry = projectedEntries[cutPoint.firstKeptEntryIndex]?.sourceEntry;
  if (firstKeptEntry?.id === undefined || firstKeptEntry?.id === "") return undefined;
  const { messagesToSummarize, turnPrefixMessages } = collectMessages(
    projectedEntries,
    boundaryStart,
    cutPoint,
  );
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

  const sourceEntries = projectedEntries.map((entry) => entry.sourceEntry);
  const fileOps = extractFileOperations(messagesToSummarize, sourceEntries, prevCompactionIndex);
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps);
    }
  }

  return {
    fileOps,
    firstKeptEntryId: firstKeptEntry.id,
    isSplitTurn: cutPoint.isSplitTurn,
    messagesToSummarize,
    previousSummary,
    settings,
    tokensBefore: estimateProjectedContextTokens(projection, pathEntries).tokens,
    turnPrefixMessages,
  };
};

export const prepareCompaction: {
  (
    settings: CompactionSettings,
  ): (pathEntries: SessionEntry[]) => CompactionPreparation | undefined;
  (pathEntries: SessionEntry[], settings: CompactionSettings): CompactionPreparation | undefined;
} = Fn.dual(2, prepareCompactionImpl);
