import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
} from "@msa/ai";
import { createAssistantMessageEventStream } from "@msa/ai";
import { Context, Effect, Random } from "effect";

import {
  buildAssistantMessage,
  type FauxResponse,
  type FauxResponseInput,
  normalizeResponse,
} from "./faux-model.ts";

export interface FauxStreamFnState {
  callCount: number;
  contexts: TranscriptContext[];
}

const random = Context.get(Context.empty(), Random.Random);

const chunkString = (text: string): string[] => {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const size = 3 + (random.nextIntUnsafe() % 3);
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks.length > 0 ? chunks : [""];
};

type DeltaType = "text_delta" | "thinking_delta" | "toolcall_delta";

const makeEvent = (
  type: DeltaType,
  contentIndex: number,
  delta: string,
  partial: AssistantMessage,
): AssistantMessageEvent => ({ type, contentIndex, delta, partial: { ...partial } });

const pushThinking = (
  stream: AssistantMessageEventStream,
  block: ThinkingContent,
  contentIndex: number,
  partial: AssistantMessage,
): void => {
  partial.content = [...partial.content, { type: "thinking", thinking: "" }];
  stream.push({ type: "thinking_start", contentIndex, partial: { ...partial } });
  for (const chunk of chunkString(block.thinking)) {
    (partial.content[contentIndex] as ThinkingContent).thinking += chunk;
    stream.push(makeEvent("thinking_delta", contentIndex, chunk, partial));
  }
  stream.push({
    type: "thinking_end",
    contentIndex,
    content: block.thinking,
    partial: { ...partial },
  });
};

const pushText = (
  stream: AssistantMessageEventStream,
  block: TextContent,
  contentIndex: number,
  partial: AssistantMessage,
): void => {
  partial.content = [...partial.content, { type: "text", text: "" }];
  stream.push({ type: "text_start", contentIndex, partial: { ...partial } });
  for (const chunk of chunkString(block.text)) {
    (partial.content[contentIndex] as TextContent).text += chunk;
    stream.push(makeEvent("text_delta", contentIndex, chunk, partial));
  }
  stream.push({ type: "text_end", contentIndex, content: block.text, partial: { ...partial } });
};

const pushToolCall = (
  stream: AssistantMessageEventStream,
  block: ToolCall,
  contentIndex: number,
  partial: AssistantMessage,
): void => {
  partial.content = [
    ...partial.content,
    { type: "toolCall", id: block.id, name: block.name, arguments: {} },
  ];
  stream.push({ type: "toolcall_start", contentIndex, partial: { ...partial } });
  for (const chunk of chunkString(JSON.stringify(block.arguments))) {
    stream.push(makeEvent("toolcall_delta", contentIndex, chunk, partial));
  }
  (partial.content[contentIndex] as ToolCall).arguments = block.arguments;
  stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: { ...partial } });
};

const pushEnd = (stream: AssistantMessageEventStream, message: AssistantMessage): void => {
  if (message.stopReason === "pending") {
    stream.push({
      type: "error",
      reason: "error",
      error: {
        ...message,
        stopReason: "error",
        errorMessage: "Faux response ended without a stop reason",
      },
    });
    return;
  }
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ type: "error", reason: message.stopReason, error: message });
    return;
  }
  stream.push({ type: "done", reason: message.stopReason, message });
};

const streamWithDeltas = (stream: AssistantMessageEventStream, message: AssistantMessage): void => {
  const partial: AssistantMessage = { ...message, content: [], stopReason: "pending" };
  stream.push({ type: "start", partial: { ...partial } });
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === "thinking") pushThinking(stream, block, contentIndex, partial);
    else if (block.type === "text") pushText(stream, block, contentIndex, partial);
    else pushToolCall(stream, block, contentIndex, partial);
  }
  pushEnd(stream, message);
};

const emitResponse = (
  stream: AssistantMessageEventStream,
  resp: FauxResponse,
  delayMs: number | undefined,
): void => {
  const message = buildAssistantMessage(resp);
  const emit = (): void => {
    streamWithDeltas(stream, message);
  };
  if (delayMs !== undefined && delayMs > 0) {
    Effect.runFork(Effect.sleep(delayMs).pipe(Effect.andThen(Effect.sync(emit))));
  } else {
    queueMicrotask(emit);
  }
};

export const createFauxStreamFn = (
  responses: FauxResponseInput[],
): {
  streamFn: (
    model: Model<any>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
  state: FauxStreamFnState;
} => {
  if (responses.length === 0) {
    throw new Error("createFauxStreamFn requires at least one response");
  }
  const state: FauxStreamFnState = { callCount: 0, contexts: [] };
  const streamFn = (
    _model: Model<any>,
    context: TranscriptContext,
    _options?: SimpleStreamOptions,
  ) => {
    const response = responses[state.callCount % responses.length];
    state.callCount++;
    state.contexts.push(context);
    if (response === undefined) {
      throw new Error("createFauxStreamFn requires at least one response");
    }
    const resp = normalizeResponse(response);
    const stream = createAssistantMessageEventStream();
    emitResponse(stream, resp, resp.delayMs);
    return stream;
  };
  return { streamFn, state };
};
