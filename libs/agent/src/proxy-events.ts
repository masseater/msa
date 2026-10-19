import {
  type AssistantMessage,
  type AssistantMessageEvent,
  parseStreamingJson,
  type StopReason,
  type ToolCall,
} from "@msa/ai";

export type ProxyAssistantMessageEvent =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; contentSignature?: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; contentSignature?: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse">;
      usage: AssistantMessage["usage"];
      providerThinkingLevel?: string;
    }
  | {
      type: "error";
      reason: Extract<StopReason, "aborted" | "error">;
      errorMessage?: string | undefined;
      usage: AssistantMessage["usage"];
      providerThinkingLevel?: string;
    };

type ProxyEventOf<K extends ProxyAssistantMessageEvent["type"]> = Extract<
  ProxyAssistantMessageEvent,
  { type: K }
>;

type Handlers = {
  readonly [K in ProxyAssistantMessageEvent["type"]]: (
    event: ProxyEventOf<K>,
    partial: AssistantMessage,
  ) => AssistantMessageEvent | undefined;
};

type StreamingToolCall = ToolCall & { partialJson?: string };

const contentAt = (partial: AssistantMessage, index: number) => partial.content[index];

const textHandlers = {
  text_start: (event, partial) => {
    partial.content[event.contentIndex] = { type: "text", text: "" };
    return { type: "text_start", contentIndex: event.contentIndex, partial };
  },
  text_delta: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "text") throw new Error("Received text_delta for non-text content");
    content.text += event.delta;
    return { type: "text_delta", contentIndex: event.contentIndex, delta: event.delta, partial };
  },
  text_end: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "text") throw new Error("Received text_end for non-text content");
    if (event.contentSignature === undefined) delete content.textSignature;
    else content.textSignature = event.contentSignature;
    return { type: "text_end", contentIndex: event.contentIndex, content: content.text, partial };
  },
} satisfies Pick<Handlers, "text_start" | "text_delta" | "text_end">;

const thinkingHandlers = {
  thinking_start: (event, partial) => {
    partial.content[event.contentIndex] = { type: "thinking", thinking: "" };
    return { type: "thinking_start", contentIndex: event.contentIndex, partial };
  },
  thinking_delta: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "thinking") {
      throw new Error("Received thinking_delta for non-thinking content");
    }
    content.thinking += event.delta;
    return {
      type: "thinking_delta",
      contentIndex: event.contentIndex,
      delta: event.delta,
      partial,
    };
  },
  thinking_end: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "thinking") {
      throw new Error("Received thinking_end for non-thinking content");
    }
    if (event.contentSignature === undefined) delete content.thinkingSignature;
    else content.thinkingSignature = event.contentSignature;
    return {
      type: "thinking_end",
      contentIndex: event.contentIndex,
      content: content.thinking,
      partial,
    };
  },
} satisfies Pick<Handlers, "thinking_start" | "thinking_delta" | "thinking_end">;

const toolCallHandlers = {
  toolcall_start: (event, partial) => {
    partial.content[event.contentIndex] = {
      type: "toolCall",
      id: event.id,
      name: event.toolName,
      arguments: {},
      partialJson: "",
    } satisfies StreamingToolCall as ToolCall;
    return { type: "toolcall_start", contentIndex: event.contentIndex, partial };
  },
  toolcall_delta: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "toolCall") {
      throw new Error("Received toolcall_delta for non-toolCall content");
    }
    const streaming = content as StreamingToolCall;
    streaming.partialJson = `${streaming.partialJson ?? ""}${event.delta}`;
    content.arguments = parseStreamingJson(streaming.partialJson) ?? {};
    partial.content[event.contentIndex] = { ...content };
    return {
      type: "toolcall_delta",
      contentIndex: event.contentIndex,
      delta: event.delta,
      partial,
    };
  },
  toolcall_end: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "toolCall") return undefined;
    Object.assign(content, event.toolCall);
    delete (content as StreamingToolCall).partialJson;
    return { type: "toolcall_end", contentIndex: event.contentIndex, toolCall: content, partial };
  },
} satisfies Pick<Handlers, "toolcall_start" | "toolcall_delta" | "toolcall_end">;

const finish = (
  partial: AssistantMessage,
  event: ProxyEventOf<"done"> | ProxyEventOf<"error">,
): void => {
  partial.stopReason = event.reason;
  partial.usage = event.usage;
  if (event.providerThinkingLevel !== undefined) {
    partial.providerThinkingLevel = event.providerThinkingLevel;
  }
};

const handlers: Handlers = {
  start: (_event, partial) => ({ type: "start", partial }),
  ...textHandlers,
  ...thinkingHandlers,
  ...toolCallHandlers,
  done: (event, partial) => {
    finish(partial, event);
    return { type: "done", reason: event.reason, message: partial };
  },
  error: (event, partial) => {
    if (event.errorMessage === undefined) delete partial.errorMessage;
    else partial.errorMessage = event.errorMessage;
    finish(partial, event);
    return { type: "error", reason: event.reason, error: partial };
  },
};

export type ProxyEventOutcome =
  | { readonly known: true; readonly event: AssistantMessageEvent | undefined }
  | { readonly known: false; readonly type: unknown };

export interface ProxyEventUpdate {
  readonly event: ProxyAssistantMessageEvent;
  readonly partial: AssistantMessage;
}

export const processProxyEvent = ({ event, partial }: ProxyEventUpdate): ProxyEventOutcome => {
  const handler = (handlers as Record<string, Handlers[keyof Handlers] | undefined>)[event.type];
  if (handler === undefined) return { known: false, type: event.type };
  return {
    known: true,
    event: (handler as (e: typeof event, p: AssistantMessage) => AssistantMessageEvent | undefined)(
      event,
      partial,
    ),
  };
};
