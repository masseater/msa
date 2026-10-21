import type typesModule from "../types.types.ts";
import transcript from "../utils/transcript.ts";
import constrainedSampling from "./constrained-sampling.ts";
import openaiCompletionsStreamReasoning from "./openai-completions-stream-reasoning.ts";
import openaiCompletionsStreamStateKit from "./openai-completions-stream-state-kit.ts";
import type openaiCompletionsStreamStateTypes from "./openai-completions-stream-state.types.ts";
import openaiCompletionsStreamToolCalls from "./openai-completions-stream-tool-calls.ts";
import type openaiCompletionsStreamTypesModule from "./openai-completions-stream-types.types.ts";

const { clock, jsonParse } = openaiCompletionsStreamStateKit;

const { currentTimeMillis } = clock;
const { createGrammarToolInputProperties } = constrainedSampling;
const { getDeclaredTools, resolveTranscript } = transcript;
const { applyStreamedReasoningDetails } = openaiCompletionsStreamReasoning;
const { parseToolCallArguments } = jsonParse;
const { appendCustomToolCallInput, getCustomToolCallInput } = openaiCompletionsStreamToolCalls;
function createOutput(
  model: typesModule.Model<"openai-completions">,
): typesModule.AssistantMessage {
  return {
    api: model.api as typesModule.Api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function createCompletionsStreamState(
  input: openaiCompletionsStreamStateTypes.CreateStateInput,
): openaiCompletionsStreamTypesModule.CompletionsStreamState {
  const output = createOutput(input.model);
  return {
    blocks: output.content as openaiCompletionsStreamTypesModule.StreamingBlock[],
    compat: input.compat,
    events: input.events,
    grammarToolInputProperties: createGrammarToolInputProperties(
      getDeclaredTools(
        resolveTranscript(input.context, input.compat.supportsMidConvoSystemMessages).messages,
      ),
      input.compat.supportsOpenAIGrammarTools,
    ),
    hasFinishReason: false,
    model: input.model,
    options: input.options,
    output,
    streamedReasoningDetails: undefined,
    textBlock: null,
    thinkingBlock: null,
    toolCallBlocksById: new Map(),
    toolCallBlocksByIndex: new Map(),
  };
}

function contentIndexOf(input: {
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState;
  block: openaiCompletionsStreamTypesModule.StreamingBlock;
}): number {
  return input.state.blocks.indexOf(input.block);
}

function finishTextBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  block: typesModule.TextContent,
): void {
  state.events.push({
    content: block.text,
    contentIndex: contentIndexOf({ block, state }),
    partial: state.output,
    type: "text_end",
  });
}

function finishThinkingBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  block: typesModule.ThinkingContent,
): void {
  applyStreamedReasoningDetails({ block, state });
  state.events.push({
    content: block.thinking,
    contentIndex: contentIndexOf({ block, state }),
    partial: state.output,
    type: "thinking_end",
  });
}

function finishToolCallBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  block: openaiCompletionsStreamTypesModule.StreamingToolCallBlock,
): void {
  const contentIndex = contentIndexOf({ block, state });
  if (block.customInput === undefined) {
    Object.assign(block, parseToolCallArguments(block.partialArgs));
  } else {
    const delta = appendCustomToolCallInput({
      block,
      close: true,
      nextInput: getCustomToolCallInput({ block }),
    });
    if (delta !== undefined) {
      state.events.push({ contentIndex, delta, partial: state.output, type: "toolcall_delta" });
    }
  }
  delete block.partialArgs;
  delete block.customInput;
  delete block.streamIndex;
  state.events.push({
    contentIndex,
    partial: state.output,
    toolCall: block,
    type: "toolcall_end",
  });
}

function finishBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  block: openaiCompletionsStreamTypesModule.StreamingBlock,
): void {
  if (contentIndexOf({ block, state }) === -1) return;
  if (block.type === "text") return finishTextBlock(state, block);
  if (block.type === "thinking") return finishThinkingBlock(state, block);
  return finishToolCallBlock(state, block);
}

function finishAllBlocks(state: openaiCompletionsStreamTypesModule.CompletionsStreamState): void {
  for (const block of state.blocks) {
    finishBlock(state, block);
  }
}

function ensureTextBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
): typesModule.TextContent {
  if (state.textBlock === null) {
    const block: typesModule.TextContent = { text: "", type: "text" };
    state.textBlock = block;
    state.blocks.push(block);
    state.events.push({
      contentIndex: contentIndexOf({ block, state }),
      partial: state.output,
      type: "text_start",
    });
  }
  return state.textBlock;
}

function ensureThinkingBlock(input: {
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState;
  thinkingSignature: string;
}): typesModule.ThinkingContent {
  const { state, thinkingSignature } = input;
  if (state.thinkingBlock === null) {
    const block: typesModule.ThinkingContent = {
      thinking: "",
      thinkingSignature,
      type: "thinking",
    };
    state.thinkingBlock = block;
    state.blocks.push(block);
    state.events.push({
      contentIndex: contentIndexOf({ block, state }),
      partial: state.output,
      type: "thinking_start",
    });
  }
  return state.thinkingBlock;
}

const openaiCompletionsStreamState = {
  contentIndexOf,
  createCompletionsStreamState,
  ensureTextBlock,
  ensureThinkingBlock,
  finishAllBlocks,
};

export default openaiCompletionsStreamState;
