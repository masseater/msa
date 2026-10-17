import type { AssistantMessage, Message } from "@msa/ai";
import { calculateContextTokens, estimateMessageTokens } from "@msa/ai/utils/estimate";
import { Function } from "effect";

import { orderToolResults } from "./context.ts";
import type { ContextView, Dual2 } from "./types.ts";

export const selectCut: Dual2<ContextView, number, number | undefined> = Function.dual(
  2,
  (view: ContextView, keepRecentTokens: number): number | undefined => {
    const { contributions } = view;
    const start = view.head === undefined ? 0 : 1;
    const candidates: number[] = [];
    for (let index = start; index < contributions.length; index++) {
      if (isCandidate(contributions, index)) candidates.push(index);
    }
    let kept = 0;
    let cut: number | undefined;
    for (let index = contributions.length - 1; index >= start; index--) {
      for (const message of contributions[index]!) kept += estimateMessageTokens(message);
      if (kept < keepRecentTokens) continue;
      cut = candidates.find((candidate) => candidate >= index) ?? candidates.at(-1);
      break;
    }
    if (cut === undefined) return undefined;
    for (let index = start; index < cut; index++) if (contributions[index]!.length > 0) return cut;
    return undefined;
  },
);

function isCandidate(contributions: ContextView["contributions"], index: number): boolean {
  const first = contributions[index]![0];
  if (first?.role === "assistant") return true;
  if (first?.role !== "user") return false;
  let calls: ReadonlySet<string> = new Set();
  for (let before = index - 1; before >= 0; before--) {
    const assistant = contributions[before]!.findLast((message) => message.role === "assistant");
    if (assistant === undefined) continue;
    calls = new Set(
      assistant.content.flatMap((content) => (content.type === "toolCall" ? [content.id] : [])),
    );
    break;
  }
  if (calls.size === 0) return true;
  for (let after = index; after < contributions.length; after++) {
    for (const [position, message] of contributions[after]!.entries()) {
      if (message.role === "assistant" && (after > index || position > 0)) return true;
      if (message.role === "toolResult" && calls.has(message.toolCallId)) return false;
    }
  }
  return true;
}

export const summarizedMessages: Dual2<ContextView, number, Message[]> = Function.dual(
  2,
  (view: ContextView, cut: number): Message[] =>
    orderToolResults(view.contributions.slice(0, cut).flat()),
);

export const estimateContext: Dual2<ContextView, readonly Message[], number> = Function.dual(
  2,
  (view: ContextView, extra: readonly Message[]): number => {
    let measured: AssistantMessage | undefined;
    const after = view.head?.id ?? Number.NEGATIVE_INFINITY;
    for (let index = view.entries.length - 1; index >= 0 && measured === undefined; index--) {
      if (view.entries[index]!.id <= after) continue;
      measured = view.contributions[index]!.findLast(
        (message): message is AssistantMessage =>
          message.role === "assistant" && calculateContextTokens(message.usage) > 0,
      );
    }
    const from = measured === undefined ? 0 : view.messages.lastIndexOf(measured) + 1;
    let tokens = measured === undefined ? 0 : calculateContextTokens(measured.usage);
    for (const message of view.messages.slice(from)) tokens += estimateMessageTokens(message);
    for (const message of extra) tokens += estimateMessageTokens(message);
    return tokens;
  },
);
