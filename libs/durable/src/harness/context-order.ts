import type aiTypes from "@msa/ai/index.types";

import contextFreeze from "./context-freeze.ts";

const { freezeJson } = contextFreeze;

const MISSING_RESULT_TEXT = "Tool result unavailable: history ends before this call completed.";

function orderToolResults(messages: readonly aiTypes.Message[]): aiTypes.Message[] {
  const ordered: aiTypes.Message[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "toolResult") continue;
    ordered.push(message);
    if (message.role !== "assistant") continue;
    const calls = message.content.filter(
      (content): content is aiTypes.ToolCall => content.type === "toolCall",
    );
    if (calls.length === 0) continue;
    const results = new Map<string, number>();
    for (
      let next = index + 1;
      next < messages.length && messages[next]!.role !== "assistant";
      next++
    ) {
      const candidate = messages[next]!;
      if (candidate.role === "toolResult" && !results.has(candidate.toolCallId)) {
        results.set(candidate.toolCallId, next);
      }
    }
    for (const call of calls) {
      const resultIndex = results.get(call.id);
      ordered.push(
        resultIndex === undefined ? missingResult(call, message.timestamp) : messages[resultIndex]!,
      );
    }
  }
  return ordered;
}

function missingResult(call: aiTypes.ToolCall, timestamp: number): aiTypes.ToolResultMessage {
  return freezeJson({
    content: [{ text: MISSING_RESULT_TEXT, type: "text" }],
    details: { reason: "missing_result" },
    isError: true,
    role: "toolResult",
    timestamp,
    toolCallId: call.id,
    toolName: call.name,
  });
}

const contextOrder = {
  orderToolResults,
};

export default contextOrder;
