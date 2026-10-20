import type { AssistantMessage } from "@msa/ai";
import testing from "@msa/testing";

const { currentTimeMillis } = testing;

function assistant(reply: string): AssistantMessage {
  return {
    api: "faux" as const,
    content: [{ text: reply, type: "text" as const }],
    model: "faux",
    provider: "faux",
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 10,
      output: 1,
      totalTokens: 11,
    },
  };
}

function text(message: { content: string | Array<{ type: string; text?: string }> }): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("");
}

const sessionContextEditSupport = {
  assistant,
  text,
};

export default sessionContextEditSupport;
