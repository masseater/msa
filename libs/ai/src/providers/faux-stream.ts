import { Effect } from "effect";

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../types.ts";
import { encodeJsonSync } from "../utils/json-codec.ts";
import { nextRandom } from "../utils/random.ts";
import { abortedMessage, type FauxContentBlock } from "./faux-messages.ts";
import { estimateTokens } from "./faux-usage.ts";

export interface FauxPacing {
  readonly minTokenSize: number;
  readonly maxTokenSize: number;
  readonly tokensPerSecond: number | undefined;
}

export interface FauxDelivery {
  readonly stream: AssistantMessageEventStream;
  readonly message: AssistantMessage;
  readonly pacing: FauxPacing;
  readonly signal: AbortSignal | undefined;
}

interface BlockRun {
  readonly stream: AssistantMessageEventStream;
  readonly partial: AssistantMessage;
  readonly pacing: FauxPacing;
  readonly signal: AbortSignal | undefined;
}

function splitStringByTokenSize(text: string, pacing: FauxPacing): string[] {
  const { minTokenSize, maxTokenSize } = pacing;
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const tokenSize = minTokenSize + Math.floor(nextRandom() * (maxTokenSize - minTokenSize + 1));
    const charSize = Math.max(1, tokenSize * 4);
    chunks.push(text.slice(index, index + charSize));
    index += charSize;
  }
  return chunks.length > 0 ? chunks : [""];
}

function scheduleChunk(chunk: string, tokensPerSecond: number | undefined): Effect.Effect<void> {
  if (tokensPerSecond === undefined || Number.isNaN(tokensPerSecond) || tokensPerSecond <= 0) {
    return Effect.promise(() => Promise.resolve());
  }
  return Effect.sleep((estimateTokens(chunk) / tokensPerSecond) * 1000);
}

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted ?? false;

const snapshot = (run: BlockRun): AssistantMessage => ({ ...run.partial });

function abortStream(run: BlockRun): void {
  const aborted = abortedMessage(run.partial);
  run.stream.push({ type: "error", reason: "aborted", error: aborted });
  run.stream.end(aborted);
}

const streamChunks = Effect.fn("streamChunks")(function* (
  run: BlockRun,
  text: string,
  onChunk: (chunk: string) => void,
) {
  for (const chunk of splitStringByTokenSize(text, run.pacing)) {
    yield* scheduleChunk(chunk, run.pacing.tokensPerSecond);
    if (isAborted(run.signal)) return false;
    onChunk(chunk);
  }
  return true;
});

const streamThinking = Effect.fn("streamThinking")(function* (
  run: BlockRun,
  contentIndex: number,
  block: ThinkingContent,
) {
  run.partial.content = [...run.partial.content, { type: "thinking", thinking: "" }];
  run.stream.push({ type: "thinking_start", contentIndex, partial: snapshot(run) });
  const completed = yield* streamChunks(run, block.thinking, (delta) => {
    (run.partial.content[contentIndex] as ThinkingContent).thinking += delta;
    run.stream.push({ type: "thinking_delta", contentIndex, delta, partial: snapshot(run) });
  });
  if (!completed) return false;
  run.stream.push({
    type: "thinking_end",
    contentIndex,
    content: block.thinking,
    partial: snapshot(run),
  });
  return true;
});

const streamText = Effect.fn("streamText")(function* (
  run: BlockRun,
  contentIndex: number,
  block: TextContent,
) {
  run.partial.content = [...run.partial.content, { type: "text", text: "" }];
  run.stream.push({ type: "text_start", contentIndex, partial: snapshot(run) });
  const completed = yield* streamChunks(run, block.text, (delta) => {
    (run.partial.content[contentIndex] as TextContent).text += delta;
    run.stream.push({ type: "text_delta", contentIndex, delta, partial: snapshot(run) });
  });
  if (!completed) return false;
  run.stream.push({ type: "text_end", contentIndex, content: block.text, partial: snapshot(run) });
  return true;
});

const streamToolCall = Effect.fn("streamToolCall")(function* (
  run: BlockRun,
  contentIndex: number,
  block: ToolCall,
) {
  run.partial.content = [
    ...run.partial.content,
    { type: "toolCall", id: block.id, name: block.name, arguments: {} },
  ];
  run.stream.push({ type: "toolcall_start", contentIndex, partial: snapshot(run) });
  const completed = yield* streamChunks(run, encodeJsonSync(block.arguments), (delta) => {
    run.stream.push({ type: "toolcall_delta", contentIndex, delta, partial: snapshot(run) });
  });
  if (!completed) return false;
  (run.partial.content[contentIndex] as ToolCall).arguments = block.arguments;
  run.stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: snapshot(run) });
  return true;
});

function streamBlock(
  run: BlockRun,
  contentIndex: number,
  block: FauxContentBlock,
): Effect.Effect<boolean> {
  if (block.type === "thinking") return streamThinking(run, contentIndex, block);
  if (block.type === "text") return streamText(run, contentIndex, block);
  return streamToolCall(run, contentIndex, block);
}

function finishStream(stream: AssistantMessageEventStream, message: AssistantMessage): void {
  if (message.stopReason === "pending") {
    throw new Error("Faux response ended without a stop reason");
  }
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ type: "error", reason: message.stopReason, error: message });
  } else {
    stream.push({ type: "done", reason: message.stopReason, message });
  }
  stream.end(message);
}

export const streamFauxMessage = Effect.fn("streamFauxMessage")(function* ({
  stream,
  message,
  pacing,
  signal,
}: FauxDelivery) {
  const run: BlockRun = {
    stream,
    partial: { ...message, content: [], stopReason: "pending" },
    pacing,
    signal,
  };
  if (isAborted(signal)) return abortStream(run);
  stream.push({ type: "start", partial: snapshot(run) });
  for (const [contentIndex, block] of message.content.entries()) {
    if (isAborted(signal) || !(yield* streamBlock(run, contentIndex, block))) {
      return abortStream(run);
    }
  }
  finishStream(stream, message);
});
