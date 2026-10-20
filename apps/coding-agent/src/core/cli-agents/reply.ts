import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import { nowMs } from "../../core/platform.ts";

const { createAssistantMessageEventStream } = compat;

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
}

export type ReplyBuilder = ReturnType<typeof createReply>;

export function createReply(model: compatTypes.Model<string>) {
  const stream = createAssistantMessageEventStream();
  const message: compatTypes.AssistantMessage = {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: nowMs(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  } as compatTypes.AssistantMessage;

  let started = false;
  let ended = false;
  const open = new Map<string, { index: number; kind: "text" | "thinking" }>();

  const start = () => {
    if (started) return;
    started = true;
    stream.push({ partial: message, type: "start" });
  };

  const block = (key: string, kind: "text" | "thinking") => {
    const mapKey = `${kind}:${key}`;
    let entry = open.get(mapKey);
    if (entry === undefined) {
      start();
      entry = { index: message.content.length, kind };
      message.content.push(
        (kind === "text"
          ? { text: "", type: "text" }
          : { thinking: "", type: "thinking" }) as compatTypes.AssistantMessage["content"][number],
      );
      open.set(mapKey, entry);
      stream.push({ contentIndex: entry.index, partial: message, type: `${kind}_start` });
    }
    return entry.index;
  };

  const closeBlocks = () => {
    for (const { index, kind } of open.values()) {
      const content = message.content[index] as { text?: string; thinking?: string };
      stream.push({
        content: (kind === "text" ? content.text : content.thinking) ?? "",
        contentIndex: index,
        partial: message,
        type: `${kind}_end`,
      });
    }
    open.clear();
  };

  const appendText = (key: string, delta: string) => {
    if (delta === "") return;
    const index = block(key, "text");
    (message.content[index] as { text: string }).text += delta;
    stream.push({ contentIndex: index, delta, partial: message, type: "text_delta" });
  };

  const finalizeUsage = () => {
    const usage = message.usage;
    usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  };

  return {
    addUsage(usage: Partial<Usage>) {
      message.usage.input += usage.input ?? 0;
      message.usage.output += usage.output ?? 0;
      message.usage.cacheRead += usage.cacheRead ?? 0;
      message.usage.cacheWrite += usage.cacheWrite ?? 0;
      if (usage.reasoning !== undefined) {
        message.usage.reasoning = (message.usage.reasoning ?? 0) + usage.reasoning;
      }
    },
    appendText,
    appendThinking(key: string, delta: string) {
      if (delta === "") return;
      const index = block(key, "thinking");
      (message.content[index] as { thinking: string }).thinking += delta;
      stream.push({ type: "thinking_delta", contentIndex: index, delta, partial: message });
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
    get hasContent() {
      return message.content.length > 0;
    },
    message,
    replaceUsage(usage: Usage) {
      Object.assign(message.usage, usage);
    },
    setText(key: string, full: string) {
      const current = open.get(`text:${key}`);
      const have =
        current === undefined ? "" : (message.content[current.index] as { text: string }).text;
      if (full.length > have.length && full.startsWith(have))
        appendText(key, full.slice(have.length));
    },
    stream,
    toolCall(id: string, name: string, args: compatTypes.JsonObject) {
      closeBlocks();
      start();
      const index = message.content.length;
      const call = {
        type: "toolCall",
        id,
        name,
        arguments: args,
      } as compatTypes.AssistantMessage["content"][number];
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
  };
}
