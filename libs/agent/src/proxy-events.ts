import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type proxyEventsTypes from "./proxy-events.types.ts";

const { parseStreamingJson } = ai;

type ProxyEventOf<K extends proxyEventsTypes.ProxyAssistantMessageEvent["type"]> = Extract<
  proxyEventsTypes.ProxyAssistantMessageEvent,
  { type: K }
>;

type Handlers = {
  readonly [K in proxyEventsTypes.ProxyAssistantMessageEvent["type"]]: (
    event: ProxyEventOf<K>,
    partial: aiTypes.AssistantMessage,
  ) => aiTypes.AssistantMessageEvent | undefined;
};

type StreamingToolCall = aiTypes.ToolCall & { partialJson?: string };

const contentAt = (partial: aiTypes.AssistantMessage, index: number) => partial.content[index];

const textHandlers = {
  text_delta: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "text") throw new Error("Received text_delta for non-text content");
    content.text += event.delta;
    return { contentIndex: event.contentIndex, delta: event.delta, partial, type: "text_delta" };
  },
  text_end: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "text") throw new Error("Received text_end for non-text content");
    if (event.contentSignature === undefined) delete content.textSignature;
    else content.textSignature = event.contentSignature;
    return { content: content.text, contentIndex: event.contentIndex, partial, type: "text_end" };
  },
  text_start: (event, partial) => {
    partial.content[event.contentIndex] = { text: "", type: "text" };
    return { contentIndex: event.contentIndex, partial, type: "text_start" };
  },
} satisfies Pick<Handlers, "text_start" | "text_delta" | "text_end">;

const thinkingHandlers = {
  thinking_delta: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "thinking") {
      throw new Error("Received thinking_delta for non-thinking content");
    }
    content.thinking += event.delta;
    return {
      contentIndex: event.contentIndex,
      delta: event.delta,
      partial,
      type: "thinking_delta",
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
      content: content.thinking,
      contentIndex: event.contentIndex,
      partial,
      type: "thinking_end",
    };
  },
  thinking_start: (event, partial) => {
    partial.content[event.contentIndex] = { thinking: "", type: "thinking" };
    return { contentIndex: event.contentIndex, partial, type: "thinking_start" };
  },
} satisfies Pick<Handlers, "thinking_start" | "thinking_delta" | "thinking_end">;

const toolCallHandlers = {
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
      contentIndex: event.contentIndex,
      delta: event.delta,
      partial,
      type: "toolcall_delta",
    };
  },
  toolcall_end: (event, partial) => {
    const content = contentAt(partial, event.contentIndex);
    if (content?.type !== "toolCall") return undefined;
    Object.assign(content, event.toolCall);
    delete (content as StreamingToolCall).partialJson;
    return { contentIndex: event.contentIndex, partial, toolCall: content, type: "toolcall_end" };
  },
  toolcall_start: (event, partial) => {
    partial.content[event.contentIndex] = {
      arguments: {},
      id: event.id,
      name: event.toolName,
      partialJson: "",
      type: "toolCall",
    } satisfies StreamingToolCall as aiTypes.ToolCall;
    return { contentIndex: event.contentIndex, partial, type: "toolcall_start" };
  },
} satisfies Pick<Handlers, "toolcall_start" | "toolcall_delta" | "toolcall_end">;

const finish = (
  partial: aiTypes.AssistantMessage,
  event: ProxyEventOf<"done"> | ProxyEventOf<"error">,
): void => {
  partial.stopReason = event.reason;
  partial.usage = event.usage;
  if (event.providerThinkingLevel !== undefined) {
    partial.providerThinkingLevel = event.providerThinkingLevel;
  }
};

const handlers: Handlers = {
  start: (_event, partial) => ({ partial, type: "start" }),
  ...textHandlers,
  ...thinkingHandlers,
  ...toolCallHandlers,
  done: (event, partial) => {
    finish(partial, event);
    return { message: partial, reason: event.reason, type: "done" };
  },
  error: (event, partial) => {
    if (event.errorMessage === undefined) delete partial.errorMessage;
    else partial.errorMessage = event.errorMessage;
    if (event.errorStatus === undefined) delete partial.errorStatus;
    else partial.errorStatus = event.errorStatus;
    finish(partial, event);
    return { error: partial, reason: event.reason, type: "error" };
  },
};

const processProxyEvent = ({
  event,
  partial,
}: proxyEventsTypes.ProxyEventUpdate): proxyEventsTypes.ProxyEventOutcome => {
  const handler = (handlers as Record<string, Handlers[keyof Handlers] | undefined>)[event.type];
  if (handler === undefined) return { known: false, type: event.type };
  return {
    event: (
      handler as (
        e: typeof event,
        p: aiTypes.AssistantMessage,
      ) => aiTypes.AssistantMessageEvent | undefined
    )(event, partial),
    known: true,
  };
};

const proxyEvents = {
  processProxyEvent,
};

export default proxyEvents;
