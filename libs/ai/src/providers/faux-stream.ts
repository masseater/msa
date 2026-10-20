import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import jsonCodec from "../utils/json-codec.ts";
import random from "../utils/random.ts";
import fauxMessages from "./faux-messages.ts";
import type fauxMessagesTypes from "./faux-messages.types.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";
import fauxUsage from "./faux-usage.ts";

const { nextRandom } = random;
const { estimateTokens } = fauxUsage;
const { abortedMessage } = fauxMessages;
const { encodeJsonSync } = jsonCodec;

interface BlockRun {
  readonly stream: typesModule.AssistantMessageEventStream;
  readonly partial: typesModule.AssistantMessage;
  readonly pacing: fauxStreamTypes.FauxPacing;
  readonly signal: AbortSignal | undefined;
}

function splitStringByTokenSize(text: string, pacing: fauxStreamTypes.FauxPacing): string[] {
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

const snapshot = (run: BlockRun): typesModule.AssistantMessage => ({ ...run.partial });

function abortStream(run: BlockRun): void {
  const aborted = abortedMessage(run.partial);
  run.stream.push({ error: aborted, reason: "aborted", type: "error" });
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
  block: typesModule.ThinkingContent,
) {
  run.partial.content = [...run.partial.content, { thinking: "", type: "thinking" }];
  run.stream.push({ contentIndex, partial: snapshot(run), type: "thinking_start" });
  const completed = yield* streamChunks(run, block.thinking, (delta) => {
    (run.partial.content[contentIndex] as typesModule.ThinkingContent).thinking += delta;
    run.stream.push({ contentIndex, delta, partial: snapshot(run), type: "thinking_delta" });
  });
  if (!completed) return false;
  run.stream.push({
    content: block.thinking,
    contentIndex,
    partial: snapshot(run),
    type: "thinking_end",
  });
  return true;
});

const streamText = Effect.fn("streamText")(function* (
  run: BlockRun,
  contentIndex: number,
  block: typesModule.TextContent,
) {
  run.partial.content = [...run.partial.content, { text: "", type: "text" }];
  run.stream.push({ contentIndex, partial: snapshot(run), type: "text_start" });
  const completed = yield* streamChunks(run, block.text, (delta) => {
    (run.partial.content[contentIndex] as typesModule.TextContent).text += delta;
    run.stream.push({ contentIndex, delta, partial: snapshot(run), type: "text_delta" });
  });
  if (!completed) return false;
  run.stream.push({ content: block.text, contentIndex, partial: snapshot(run), type: "text_end" });
  return true;
});

const streamToolCall = Effect.fn("streamToolCall")(function* (
  run: BlockRun,
  contentIndex: number,
  block: typesModule.ToolCall,
) {
  run.partial.content = [
    ...run.partial.content,
    { arguments: {}, id: block.id, name: block.name, type: "toolCall" },
  ];
  run.stream.push({ contentIndex, partial: snapshot(run), type: "toolcall_start" });
  const completed = yield* streamChunks(run, encodeJsonSync(block.arguments), (delta) => {
    run.stream.push({ contentIndex, delta, partial: snapshot(run), type: "toolcall_delta" });
  });
  if (!completed) return false;
  (run.partial.content[contentIndex] as typesModule.ToolCall).arguments = block.arguments;
  run.stream.push({ contentIndex, partial: snapshot(run), toolCall: block, type: "toolcall_end" });
  return true;
});

function streamBlock(
  run: BlockRun,
  contentIndex: number,
  block: fauxMessagesTypes.FauxContentBlock,
): Effect.Effect<boolean> {
  if (block.type === "thinking") return streamThinking(run, contentIndex, block);
  if (block.type === "text") return streamText(run, contentIndex, block);
  return streamToolCall(run, contentIndex, block);
}

function finishStream(
  stream: typesModule.AssistantMessageEventStream,
  message: typesModule.AssistantMessage,
): void {
  if (message.stopReason === "pending") {
    throw new Error("Faux response ended without a stop reason");
  }
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ error: message, reason: message.stopReason, type: "error" });
  } else {
    stream.push({ message, reason: message.stopReason, type: "done" });
  }
  stream.end(message);
}

const streamFauxMessage = Effect.fn("streamFauxMessage")(function* ({
  stream,
  message,
  pacing,
  signal,
}: fauxStreamTypes.FauxDelivery) {
  const run: BlockRun = {
    pacing,
    partial: { ...message, content: [], stopReason: "pending" },
    signal,
    stream,
  };
  if (isAborted(signal)) return abortStream(run);
  stream.push({ partial: snapshot(run), type: "start" });
  for (const [contentIndex, block] of message.content.entries()) {
    if (isAborted(signal) || !(yield* streamBlock(run, contentIndex, block))) {
      return abortStream(run);
    }
  }
  finishStream(stream, message);
});

const fauxStream = {
  streamFauxMessage,
};

export default fauxStream;
