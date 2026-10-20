import type agentTypes from "@msa/agent-core/index.types";
import { Function as Fn } from "effect";

import {
  type ProjectedSessionEntry,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "../session-manager.ts";
import { estimateTokens } from "./compaction-tokens.ts";
import type { CutPointResult } from "./compaction-types.ts";

function isCutPointMessage(message: agentTypes.AgentMessage): boolean {
  switch (message.role) {
    case "user":
    case "assistant":
    case "bashExecution":
    case "custom":
    case "branchSummary":
    case "compactionSummary":
      return true;
    case "toolResult":
      return false;
  }
  return false;
}

function isTurnStartMessage(message: agentTypes.AgentMessage): boolean {
  switch (message.role) {
    case "user":
    case "bashExecution":
    case "custom":
    case "branchSummary":
    case "compactionSummary":
      return true;
    case "assistant":
    case "toolResult":
      return false;
  }
  return false;
}

function isTurnStartEntry(entry: SessionEntry): boolean {
  if (entry.type === "compaction") {
    return false;
  }
  return sessionEntryToContextMessages(entry).some(isTurnStartMessage);
}

function findValidCutPoints(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    if (entry === undefined || entry.type === "compaction") {
      continue;
    }
    if (sessionEntryToContextMessages(entry).some(isCutPointMessage)) {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

const findTurnStartIndexImpl = (
  entries: SessionEntry[],
  entryIndex: number,
  startIndex: number,
): number => {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry !== undefined && isTurnStartEntry(entry)) {
      return i;
    }
  }
  return -1;
};

export const findTurnStartIndex: {
  (entryIndex: number, startIndex: number): (entries: SessionEntry[]) => number;
  (entries: SessionEntry[], entryIndex: number, startIndex: number): number;
} = Fn.dual(3, findTurnStartIndexImpl);

interface BudgetWalk {
  cutPoints: number[];
  startIndex: number;
  endIndex: number;
  keepRecentTokens: number;
  tokensAt: (index: number) => number;
}

function walkBackToBudget({
  cutPoints,
  startIndex,
  endIndex,
  keepRecentTokens,
  tokensAt,
}: BudgetWalk) {
  const firstCutPoint = cutPoints[0] ?? startIndex;
  const lastCutPoint = cutPoints.at(-1) ?? startIndex;
  let accumulatedTokens = 0;
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const messageTokens = tokensAt(i);
    if (messageTokens === 0) continue;
    accumulatedTokens += messageTokens;
    if (accumulatedTokens >= keepRecentTokens) {
      return {
        cutIndex: cutPoints.find((candidate) => candidate >= i) ?? lastCutPoint,
        exceededBudget: true,
      };
    }
  }
  return { cutIndex: firstCutPoint, exceededBudget: false };
}

function skipEmptyBack(
  startIndex: number,
  cutIndex: number,
  blocksSkipping: (index: number) => boolean,
): number {
  let index = cutIndex;
  while (index > startIndex && !blocksSkipping(index - 1)) index--;
  return index;
}

const tokensOfMessages = (messages: agentTypes.AgentMessage[]): number =>
  messages.reduce((sum, message) => sum + estimateTokens(message), 0);

const findCutPointImpl = (
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult => {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, isSplitTurn: false, turnStartIndex: -1 };
  }
  const { cutIndex: budgetIndex } = walkBackToBudget({
    cutPoints,
    endIndex,
    keepRecentTokens,
    startIndex,
    tokensAt: (index) => {
      const entry = entries[index];
      return entry === undefined ? 0 : tokensOfMessages(sessionEntryToContextMessages(entry));
    },
  });
  const cutIndex = skipEmptyBack(startIndex, budgetIndex, (index) => {
    const previous = entries[index];
    return (
      previous === undefined ||
      previous.type === "compaction" ||
      sessionEntryToContextMessages(previous).length > 0
    );
  });
  const cutEntry = entries[cutIndex];
  const startsTurn = cutEntry !== undefined && isTurnStartEntry(cutEntry);
  const turnStartIndex = startsTurn ? -1 : findTurnStartIndexImpl(entries, cutIndex, startIndex);
  return {
    firstKeptEntryIndex: cutIndex,
    isSplitTurn: !startsTurn && turnStartIndex !== -1,
    turnStartIndex,
  };
};

export const findCutPoint: {
  (
    startIndex: number,
    endIndex: number,
    keepRecentTokens: number,
  ): (entries: SessionEntry[]) => CutPointResult;
  (
    entries: SessionEntry[],
    startIndex: number,
    endIndex: number,
    keepRecentTokens: number,
  ): CutPointResult;
} = Fn.dual(4, findCutPointImpl);

function isProjectedTurnStart(entry: ProjectedSessionEntry): boolean {
  if (entry.sourceEntry.type === "compaction") return false;
  return entry.messages.some(isTurnStartMessage);
}

function findProjectedTurnStartIndex(
  entries: ProjectedSessionEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry !== undefined && isProjectedTurnStart(entry)) return i;
  }
  return -1;
}

const isIntrinsicallyVisible = (entry: ProjectedSessionEntry): boolean =>
  entry.sourceEntry.type !== "context_edit" &&
  sessionEntryToContextMessages(entry.sourceEntry).length > 0;

const isOmitted = (entry: ProjectedSessionEntry): boolean =>
  isIntrinsicallyVisible(entry) && entry.messages.length === 0;

function isRecoveryOmissionSuffix(suffix: ProjectedSessionEntry[]): boolean {
  const omittedSuffixIds = new Set(suffix.filter(isOmitted).map((entry) => entry.sourceEntry.id));
  const hasExternalReplacement = suffix.some(
    (entry) =>
      entry.sourceEntry.type === "context_edit" &&
      entry.sourceEntry.replacement !== null &&
      !omittedSuffixIds.has(entry.sourceEntry.targetId),
  );
  return (
    !hasExternalReplacement &&
    suffix.some(
      (entry) =>
        entry.sourceEntry.type === "message" &&
        entry.sourceEntry.message.role === "assistant" &&
        isOmitted(entry),
    ) &&
    suffix.every(
      (entry) =>
        entry.sourceEntry.type !== "compaction" &&
        (!isIntrinsicallyVisible(entry) || isOmitted(entry)),
    )
  );
}

function projectedCutPoints(
  entries: ProjectedSessionEntry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    if (
      entry !== undefined &&
      entry.sourceEntry.type !== "compaction" &&
      entry.messages.some(isCutPointMessage)
    )
      cutPoints.push(i);
  }
  return cutPoints;
}

export interface ProjectedCutInput {
  entries: ProjectedSessionEntry[];
  startIndex: number;
  endIndex: number;
  keepRecentTokens: number;
}

export function findProjectedCutPoint({
  entries,
  startIndex,
  endIndex,
  keepRecentTokens,
}: ProjectedCutInput): CutPointResult {
  const cutPoints = projectedCutPoints(entries, startIndex, endIndex);
  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, isSplitTurn: false, turnStartIndex: -1 };
  }
  const walked = walkBackToBudget({
    cutPoints,
    endIndex,
    keepRecentTokens,
    startIndex,
    tokensAt: (index) => tokensOfMessages(entries[index]?.messages ?? []),
  });
  const recovery =
    walked.exceededBudget && isRecoveryOmissionSuffix(entries.slice(walked.cutIndex + 1, endIndex));
  const cutIndex = skipEmptyBack(
    startIndex,
    recovery ? walked.cutIndex + 1 : walked.cutIndex,
    (index) => {
      const previous = entries[index];
      return (
        previous === undefined ||
        previous.sourceEntry.type === "compaction" ||
        previous.messages.length > 0
      );
    },
  );
  const cutEntry = entries[cutIndex];
  const startsTurn = cutEntry !== undefined && isProjectedTurnStart(cutEntry);
  const turnStartIndex = startsTurn
    ? -1
    : findProjectedTurnStartIndex(entries, cutIndex, startIndex);
  return {
    firstKeptEntryIndex: cutIndex,
    isSplitTurn: !startsTurn && turnStartIndex !== -1,
    turnStartIndex,
  };
}
