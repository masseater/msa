import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import platform from "../platform/index.ts";
import type replyTypes from "./reply.types.ts";

const { nowMs } = platform;
const { createAssistantMessageEventStream } = compat;

type Kind = "text" | "thinking";
type Content = compatTypes.AssistantMessage["content"][number];

const emptyMessage = (model: compatTypes.Model<string>): compatTypes.AssistantMessage =>
  ({
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
  }) as compatTypes.AssistantMessage;

class Reply {
  readonly stream = createAssistantMessageEventStream();
  readonly message: compatTypes.AssistantMessage;
  private started = false;
  private ended = false;
  private readonly open = new Map<string, { index: number; kind: Kind }>();

  constructor(model: compatTypes.Model<string>) {
    this.message = emptyMessage(model);
  }

  get hasContent(): boolean {
    return this.message.content.length > 0;
  }

  readonly addUsage = (usage: Partial<replyTypes.Usage>): void => {
    const total = this.message.usage;
    total.input += usage.input ?? 0;
    total.output += usage.output ?? 0;
    total.cacheRead += usage.cacheRead ?? 0;
    total.cacheWrite += usage.cacheWrite ?? 0;
    if (usage.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + usage.reasoning;
  };

  readonly replaceUsage = (usage: replyTypes.Usage): void => {
    Object.assign(this.message.usage, usage);
  };

  readonly appendText = (key: string, delta: string): void => {
    if (delta === "") return;
    const index = this.block(key, "text");
    (this.message.content[index] as { text: string }).text += delta;
    this.stream.push({ contentIndex: index, delta, partial: this.message, type: "text_delta" });
  };

  readonly appendThinking = (key: string, delta: string): void => {
    if (delta === "") return;
    const index = this.block(key, "thinking");
    (this.message.content[index] as { thinking: string }).thinking += delta;
    this.stream.push({ contentIndex: index, delta, partial: this.message, type: "thinking_delta" });
  };

  readonly setText = (key: string, full: string): void => {
    const current = this.open.get(`text:${key}`);
    const have =
      current === undefined ? "" : (this.message.content[current.index] as { text: string }).text;
    if (full.length > have.length && full.startsWith(have))
      this.appendText(key, full.slice(have.length));
  };

  readonly toolCall = (id: string, name: string, args: compatTypes.JsonObject): void => {
    this.closeBlocks();
    this.start();
    const index = this.message.content.length;
    const call = { arguments: args, id, name, type: "toolCall" } as Content;
    this.message.content.push(call);
    const partial = this.message;
    this.stream.push({ contentIndex: index, partial, type: "toolcall_start" });
    this.stream.push({
      contentIndex: index,
      delta: JSON.stringify(args),
      partial,
      type: "toolcall_delta",
    });
    this.stream.push({
      contentIndex: index,
      partial,
      toolCall: call as never,
      type: "toolcall_end",
    });
  };

  readonly done = (reason: "stop" | "toolUse" | "length"): void => {
    if (this.ended) return;
    this.ended = true;
    if (reason === "stop" && !this.message.content.some((part) => part.type === "text"))
      this.appendText("fallback", "(no reply text)");
    this.finish(reason);
    this.stream.push({ message: this.message, reason, type: "done" });
    this.stream.end();
  };

  readonly fail = (reason: "error" | "aborted", errorMessage: string, resetsAt?: number): void => {
    if (this.ended) return;
    this.ended = true;
    this.finish(reason);
    this.message.errorMessage = errorMessage;
    if (resetsAt !== undefined) this.message.errorResetsAt = resetsAt;
    this.stream.push({ error: this.message, reason, type: "error" });
    this.stream.end();
  };

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.stream.push({ partial: this.message, type: "start" });
  }

  private block(key: string, kind: Kind): number {
    const mapKey = `${kind}:${key}`;
    const existing = this.open.get(mapKey);
    if (existing !== undefined) return existing.index;
    this.start();
    const entry = { index: this.message.content.length, kind };
    this.message.content.push(
      (kind === "text"
        ? { text: "", type: "text" }
        : { thinking: "", type: "thinking" }) as Content,
    );
    this.open.set(mapKey, entry);
    this.stream.push({ contentIndex: entry.index, partial: this.message, type: `${kind}_start` });
    return entry.index;
  }

  private closeBlocks(): void {
    for (const { index, kind } of this.open.values()) {
      const content = this.message.content[index] as { text?: string; thinking?: string };
      this.stream.push({
        content: (kind === "text" ? content.text : content.thinking) ?? "",
        contentIndex: index,
        partial: this.message,
        type: `${kind}_end`,
      });
    }
    this.open.clear();
  }

  private finish(reason: compatTypes.AssistantMessage["stopReason"]): void {
    this.closeBlocks();
    const usage = this.message.usage;
    usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    this.message.stopReason = reason;
  }
}

const createReply = (model: compatTypes.Model<string>) => new Reply(model);

const reply = {
  createReply,
};

export default reply;
