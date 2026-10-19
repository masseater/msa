/**
 * Builds one msa assistant reply from incremental pieces and emits the matching
 * stream events: blocks are opened lazily, closed in order, and the stream ends
 * with exactly one terminal event.
 */
import { createAssistantMessageEventStream } from "@msa/ai/compat";
import type { AssistantMessage, JsonObject, Model } from "@msa/ai/compat";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
}

export type ReplyBuilder = ReturnType<typeof createReply>;

export function createReply(model: Model<string>) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  } as AssistantMessage;

  let started = false;
  let ended = false;
  const open = new Map<string, { index: number; kind: "text" | "thinking" }>();

  const start = () => {
    if (started) return;
    started = true;
    stream.push({ type: "start", partial: message });
  };

  const block = (key: string, kind: "text" | "thinking") => {
    const mapKey = `${kind}:${key}`;
    let entry = open.get(mapKey);
    if (!entry) {
      start();
      entry = { index: message.content.length, kind };
      message.content.push(
        (kind === "text"
          ? { type: "text", text: "" }
          : { type: "thinking", thinking: "" }) as AssistantMessage["content"][number],
      );
      open.set(mapKey, entry);
      stream.push({ type: `${kind}_start`, contentIndex: entry.index, partial: message });
    }
    return entry.index;
  };

  const closeBlocks = () => {
    for (const { index, kind } of open.values()) {
      const content = message.content[index] as { text?: string; thinking?: string };
      stream.push({
        type: `${kind}_end`,
        contentIndex: index,
        content: (kind === "text" ? content.text : content.thinking) ?? "",
        partial: message,
      });
    }
    open.clear();
  };

  const appendText = (key: string, delta: string) => {
    if (!delta) return;
    const index = block(key, "text");
    (message.content[index] as { text: string }).text += delta;
    stream.push({ type: "text_delta", contentIndex: index, delta, partial: message });
  };

  const finalizeUsage = () => {
    const usage = message.usage;
    usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  };

  return {
    stream,
    message,
    get hasContent() {
      return message.content.length > 0;
    },
    /** Set a text block's full text; only the part beyond what was already emitted is streamed. */
    setText(key: string, full: string) {
      const current = open.get(`text:${key}`);
      const have = current ? (message.content[current.index] as { text: string }).text : "";
      if (full.length > have.length && full.startsWith(have))
        appendText(key, full.slice(have.length));
    },
    appendText,
    appendThinking(key: string, delta: string) {
      if (!delta) return;
      const index = block(key, "thinking");
      (message.content[index] as { thinking: string }).thinking += delta;
      stream.push({ type: "thinking_delta", contentIndex: index, delta, partial: message });
    },
    toolCall(id: string, name: string, args: JsonObject) {
      closeBlocks();
      start();
      const index = message.content.length;
      const call = {
        type: "toolCall",
        id,
        name,
        arguments: args,
      } as AssistantMessage["content"][number];
      message.content.push(call);
      stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
      stream.push({
        type: "toolcall_delta",
        contentIndex: index,
        delta: JSON.stringify(args),
        partial: message,
      });
      stream.push({
        type: "toolcall_end",
        contentIndex: index,
        toolCall: call as never,
        partial: message,
      });
    },
    addUsage(usage: Partial<Usage>) {
      message.usage.input += usage.input ?? 0;
      message.usage.output += usage.output ?? 0;
      message.usage.cacheRead += usage.cacheRead ?? 0;
      message.usage.cacheWrite += usage.cacheWrite ?? 0;
      if (usage.reasoning !== undefined) {
        message.usage.reasoning = (message.usage.reasoning ?? 0) + usage.reasoning;
      }
    },
    replaceUsage(usage: Usage) {
      Object.assign(message.usage, usage);
    },
    done(reason: "stop" | "toolUse" | "length") {
      if (ended) return;
      ended = true;
      if (reason === "stop" && !message.content.some((part) => part.type === "text")) {
        appendText("fallback", "(no reply text)");
      }
      closeBlocks();
      finalizeUsage();
      message.stopReason = reason;
      stream.push({ type: "done", reason, message });
      stream.end();
    },
    fail(reason: "error" | "aborted", errorMessage: string) {
      if (ended) return;
      ended = true;
      closeBlocks();
      finalizeUsage();
      message.stopReason = reason;
      message.errorMessage = errorMessage;
      stream.push({ type: "error", reason, error: message });
      stream.end();
    },
  };
}
