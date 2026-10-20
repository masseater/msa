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

import fauxModelModule from "./faux-model.ts";
import type fauxModelTypes from "./faux-model.types.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";

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
  partial: AssistantMessage,
): AssistantMessageEvent => ({ contentIndex, delta, partial: { ...partial }, type });

const pushThinking = (
  stream: AssistantMessageEventStream,
  block: ThinkingContent,
  contentIndex: number,
  partial: AssistantMessage,
): void => {
  partial.content = [...partial.content, { thinking: "", type: "thinking" }];
  stream.push({ contentIndex, partial: { ...partial }, type: "thinking_start" });
  for (const chunk of chunkString(block.thinking)) {
    (partial.content[contentIndex] as ThinkingContent).thinking += chunk;
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
  stream: AssistantMessageEventStream,
  block: TextContent,
  contentIndex: number,
  partial: AssistantMessage,
): void => {
  partial.content = [...partial.content, { text: "", type: "text" }];
  stream.push({ contentIndex, partial: { ...partial }, type: "text_start" });
  for (const chunk of chunkString(block.text)) {
    (partial.content[contentIndex] as TextContent).text += chunk;
    stream.push(makeEvent("text_delta", contentIndex, chunk, partial));
  }
  stream.push({ content: block.text, contentIndex, partial: { ...partial }, type: "text_end" });
};

const pushToolCall = (
  stream: AssistantMessageEventStream,
  block: ToolCall,
  contentIndex: number,
  partial: AssistantMessage,
): void => {
  partial.content = [
    ...partial.content,
    { arguments: {}, id: block.id, name: block.name, type: "toolCall" },
  ];
  stream.push({ contentIndex, partial: { ...partial }, type: "toolcall_start" });
  for (const chunk of chunkString(JSON.stringify(block.arguments))) {
    stream.push(makeEvent("toolcall_delta", contentIndex, chunk, partial));
  }
  (partial.content[contentIndex] as ToolCall).arguments = block.arguments;
  stream.push({ contentIndex, partial: { ...partial }, toolCall: block, type: "toolcall_end" });
};

const pushEnd = (stream: AssistantMessageEventStream, message: AssistantMessage): void => {
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

const streamWithDeltas = (stream: AssistantMessageEventStream, message: AssistantMessage): void => {
  const partial: AssistantMessage = { ...message, content: [], stopReason: "pending" };
  stream.push({ partial: { ...partial }, type: "start" });
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === "thinking") pushThinking(stream, block, contentIndex, partial);
    else if (block.type === "text") pushText(stream, block, contentIndex, partial);
    else pushToolCall(stream, block, contentIndex, partial);
  }
  pushEnd(stream, message);
};

const emitResponse = (
  stream: AssistantMessageEventStream,
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
    model: Model<any>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
  state: fauxStreamTypes.FauxStreamFnState;
} => {
  if (responses.length === 0) {
    throw new Error("createFauxStreamFn requires at least one response");
  }
  const state: fauxStreamTypes.FauxStreamFnState = { callCount: 0, contexts: [] };
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
  return { state, streamFn };
};

const fauxStream = {
  createFauxStreamFn,
};

export default fauxStream;
