import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Context, Effect, Random } from "effect";

import fauxModelModule from "./faux-model.ts";
import type fauxModelTypes from "./faux-model.types.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";

const { createAssistantMessageEventStream } = ai;

const { buildAssistantMessage, normalizeResponse } = fauxModelModule;

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
  partial: aiTypes.AssistantMessage,
): aiTypes.AssistantMessageEvent => ({ contentIndex, delta, partial: { ...partial }, type });

const pushThinking = (
  stream: aiTypes.AssistantMessageEventStream,
  block: aiTypes.ThinkingContent,
  contentIndex: number,
  partial: aiTypes.AssistantMessage,
): void => {
  partial.content = [...partial.content, { thinking: "", type: "thinking" }];
  stream.push({ contentIndex, partial: { ...partial }, type: "thinking_start" });
  for (const chunk of chunkString(block.thinking)) {
    (partial.content[contentIndex] as aiTypes.ThinkingContent).thinking += chunk;
    stream.push(makeEvent("thinking_delta", contentIndex, chunk, partial));
  }
  stream.push({
    content: block.thinking,
    contentIndex,
    partial: { ...partial },
    type: "thinking_end",
  });
};

const pushText = (
  stream: aiTypes.AssistantMessageEventStream,
  block: aiTypes.TextContent,
  contentIndex: number,
  partial: aiTypes.AssistantMessage,
): void => {
  partial.content = [...partial.content, { text: "", type: "text" }];
  stream.push({ contentIndex, partial: { ...partial }, type: "text_start" });
  for (const chunk of chunkString(block.text)) {
    (partial.content[contentIndex] as aiTypes.TextContent).text += chunk;
    stream.push(makeEvent("text_delta", contentIndex, chunk, partial));
  }
  stream.push({ content: block.text, contentIndex, partial: { ...partial }, type: "text_end" });
};

const pushToolCall = (
  stream: aiTypes.AssistantMessageEventStream,
  block: aiTypes.ToolCall,
  contentIndex: number,
  partial: aiTypes.AssistantMessage,
): void => {
  partial.content = [
    ...partial.content,
    { arguments: {}, id: block.id, name: block.name, type: "toolCall" },
  ];
  stream.push({ contentIndex, partial: { ...partial }, type: "toolcall_start" });
  for (const chunk of chunkString(JSON.stringify(block.arguments))) {
    stream.push(makeEvent("toolcall_delta", contentIndex, chunk, partial));
  }
  (partial.content[contentIndex] as aiTypes.ToolCall).arguments = block.arguments;
  stream.push({ contentIndex, partial: { ...partial }, toolCall: block, type: "toolcall_end" });
};

const pushEnd = (
  stream: aiTypes.AssistantMessageEventStream,
  message: aiTypes.AssistantMessage,
): void => {
  if (message.stopReason === "pending") {
    stream.push({
      error: {
        ...message,
        errorMessage: "Faux response ended without a stop reason",
        stopReason: "error",
      },
      reason: "error",
      type: "error",
    });
    return;
  }
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ error: message, reason: message.stopReason, type: "error" });
    return;
  }
  stream.push({ message, reason: message.stopReason, type: "done" });
};

const streamWithDeltas = (
  stream: aiTypes.AssistantMessageEventStream,
  message: aiTypes.AssistantMessage,
): void => {
  const partial: aiTypes.AssistantMessage = { ...message, content: [], stopReason: "pending" };
  stream.push({ partial: { ...partial }, type: "start" });
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === "thinking") pushThinking(stream, block, contentIndex, partial);
    else if (block.type === "text") pushText(stream, block, contentIndex, partial);
    else pushToolCall(stream, block, contentIndex, partial);
  }
  pushEnd(stream, message);
};

const emitResponse = (
  stream: aiTypes.AssistantMessageEventStream,
  resp: fauxModelTypes.FauxResponse,
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

const createFauxStreamFn = (
  responses: fauxModelTypes.FauxResponseInput[],
): {
  streamFn: (
    model: aiTypes.Model<any>,
    context: aiTypes.TranscriptContext,
    options?: aiTypes.SimpleStreamOptions,
  ) => aiTypes.AssistantMessageEventStream;
  state: fauxStreamTypes.FauxStreamFnState;
} => {
  if (responses.length === 0) {
    throw new Error("createFauxStreamFn requires at least one response");
  }
  const state: fauxStreamTypes.FauxStreamFnState = { callCount: 0, contexts: [] };
  const streamFn = (
    _model: aiTypes.Model<any>,
    context: aiTypes.TranscriptContext,
    _options?: aiTypes.SimpleStreamOptions,
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
  return { state, streamFn };
};

const fauxStream = {
  createFauxStreamFn,
};

export default fauxStream;
