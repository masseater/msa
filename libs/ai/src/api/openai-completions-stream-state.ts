import type { Api, AssistantMessage, Model, TextContent, ThinkingContent } from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { parseToolCallArguments } from "../utils/json-parse.ts";
import {
  getDeclaredTools,
  resolveTranscript,
  type TranscriptContext,
} from "../utils/transcript.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import { applyStreamedReasoningDetails } from "./openai-completions-stream-reasoning.ts";
import {
  appendCustomToolCallInput,
  getCustomToolCallInput,
} from "./openai-completions-stream-tool-calls.ts";
import type {
  CompletionsStreamState,
  StreamingBlock,
  StreamingToolCallBlock,
} from "./openai-completions-stream-types.ts";
import type {
  OpenAICompletionsOptions,
  ResolvedOpenAICompletionsCompat,
} from "./openai-completions-types.ts";

interface CreateStateInput {
  readonly events: AssistantMessageEventStream;
  readonly model: Model<"openai-completions">;
  readonly context: TranscriptContext;
  readonly options: OpenAICompletionsOptions | undefined;
  readonly compat: ResolvedOpenAICompletionsCompat;
}

function createOutput(model: Model<"openai-completions">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api as Api,
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
    timestamp: currentTimeMillis(),
  };
}

function createCompletionsStreamState(input: CreateStateInput): CompletionsStreamState {
  const output = createOutput(input.model);
  return {
    events: input.events,
    output,
    model: input.model,
    options: input.options,
    compat: input.compat,
    grammarToolInputProperties: createGrammarToolInputProperties(
      getDeclaredTools(
        resolveTranscript(input.context, input.compat.supportsMidConvoSystemMessages).messages,
      ),
      input.compat.supportsOpenAIGrammarTools,
    ),
    blocks: output.content as StreamingBlock[],
    toolCallBlocksByIndex: new Map(),
    toolCallBlocksById: new Map(),
    textBlock: null,
    thinkingBlock: null,
    streamedReasoningDetails: undefined,
    hasFinishReason: false,
  };
}

function contentIndexOf(input: { state: CompletionsStreamState; block: StreamingBlock }): number {
  return input.state.blocks.indexOf(input.block);
}

function finishTextBlock(state: CompletionsStreamState, block: TextContent): void {
  state.events.push({
    type: "text_end",
    contentIndex: contentIndexOf({ state, block }),
    content: block.text,
    partial: state.output,
  });
}

function finishThinkingBlock(state: CompletionsStreamState, block: ThinkingContent): void {
  applyStreamedReasoningDetails({ state, block });
  state.events.push({
    type: "thinking_end",
    contentIndex: contentIndexOf({ state, block }),
    content: block.thinking,
    partial: state.output,
  });
}

function finishToolCallBlock(state: CompletionsStreamState, block: StreamingToolCallBlock): void {
  const contentIndex = contentIndexOf({ state, block });
  if (block.customInput === undefined) {
    Object.assign(block, parseToolCallArguments(block.partialArgs));
  } else {
    const delta = appendCustomToolCallInput({
      block,
      nextInput: getCustomToolCallInput({ block }),
      close: true,
    });
    if (delta !== undefined) {
      state.events.push({ type: "toolcall_delta", contentIndex, delta, partial: state.output });
    }
  }
  delete block.partialArgs;
  delete block.customInput;
  delete block.streamIndex;
  state.events.push({
    type: "toolcall_end",
    contentIndex,
    toolCall: block,
    partial: state.output,
  });
}

function finishBlock(state: CompletionsStreamState, block: StreamingBlock): void {
  if (contentIndexOf({ state, block }) === -1) return;
  if (block.type === "text") return finishTextBlock(state, block);
  if (block.type === "thinking") return finishThinkingBlock(state, block);
  return finishToolCallBlock(state, block);
}

function finishAllBlocks(state: CompletionsStreamState): void {
  for (const block of state.blocks) {
    finishBlock(state, block);
  }
}

function ensureTextBlock(state: CompletionsStreamState): TextContent {
  if (state.textBlock === null) {
    const block: TextContent = { type: "text", text: "" };
    state.textBlock = block;
    state.blocks.push(block);
    state.events.push({
      type: "text_start",
      contentIndex: contentIndexOf({ state, block }),
      partial: state.output,
    });
  }
  return state.textBlock;
}

function ensureThinkingBlock(input: {
  state: CompletionsStreamState;
  thinkingSignature: string;
}): ThinkingContent {
  const { state, thinkingSignature } = input;
  if (state.thinkingBlock === null) {
    const block: ThinkingContent = {
      type: "thinking",
      thinking: "",
      thinkingSignature,
    };
    state.thinkingBlock = block;
    state.blocks.push(block);
    state.events.push({
      type: "thinking_start",
      contentIndex: contentIndexOf({ state, block }),
      partial: state.output,
    });
  }
  return state.thinkingBlock;
}

export {
  contentIndexOf,
  createCompletionsStreamState,
  ensureTextBlock,
  ensureThinkingBlock,
  finishAllBlocks,
};
