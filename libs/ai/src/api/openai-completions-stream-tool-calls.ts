import constrainedSampling from "./constrained-sampling.ts";
import type constrainedSamplingTypes from "./constrained-sampling.types.ts";
import type openaiCompletionsStreamTypesModule from "./openai-completions-stream-types.types.ts";

const { appendGrammarToolInputJsonDelta } = constrainedSampling;

function emptyJsonBuffer(): constrainedSamplingTypes.GrammarToolInputJsonBuffer {
  return { closed: false, input: "", started: false };
}

function isCustomToolCall(
  toolCall: openaiCompletionsStreamTypesModule.StreamingToolCallDelta,
): boolean {
  return toolCall.custom !== undefined && toolCall.function === undefined;
}

function getCustomToolCallInput(input: {
  block: openaiCompletionsStreamTypesModule.StreamingToolCallBlock;
}): string {
  const { block } = input;
  const property = block.customInput?.property;
  if (property === undefined) return "";
  const value = block.arguments[property];
  return typeof value === "string" ? value : "";
}

function appendCustomToolCallInput(input: {
  block: openaiCompletionsStreamTypesModule.StreamingToolCallBlock;
  nextInput: string;
  close: boolean;
}): string | undefined {
  const { block, nextInput, close } = input;
  const customInput = block.customInput;
  if (customInput === undefined) return undefined;
  const delta = appendGrammarToolInputJsonDelta(
    customInput.jsonBuffer,
    customInput.property,
    nextInput,
    close,
  );
  block.arguments = { [customInput.property]: nextInput };
  return delta;
}

function findToolCallBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  toolCall: openaiCompletionsStreamTypesModule.StreamingToolCallDelta,
  streamIndex: number | undefined,
): openaiCompletionsStreamTypesModule.StreamingToolCallBlock | undefined {
  const byIndex =
    streamIndex === undefined ? undefined : state.toolCallBlocksByIndex.get(streamIndex);
  if (byIndex !== undefined) return byIndex;
  if (toolCall.id === undefined || toolCall.id === "") return undefined;
  return state.toolCallBlocksById.get(toolCall.id);
}

function registerToolCallBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  toolCall: openaiCompletionsStreamTypesModule.StreamingToolCallDelta,
  streamIndex: number | undefined,
  name: string,
): openaiCompletionsStreamTypesModule.StreamingToolCallBlock {
  const customInputProperty = isCustomToolCall(toolCall)
    ? (state.grammarToolInputProperties.get(name) ?? "input")
    : undefined;
  const hasCustomInput = customInputProperty !== undefined;
  const block: openaiCompletionsStreamTypesModule.StreamingToolCallBlock = {
    arguments: hasCustomInput ? { [customInputProperty]: "" } : {},
    customInput: hasCustomInput
      ? { jsonBuffer: emptyJsonBuffer(), property: customInputProperty }
      : undefined,
    id: toolCall.id || "",
    name,
    partialArgs: hasCustomInput ? undefined : "",
    streamIndex,
    type: "toolCall",
  };
  if (streamIndex !== undefined) {
    state.toolCallBlocksByIndex.set(streamIndex, block);
  }
  if (toolCall.id !== undefined && toolCall.id !== "") {
    state.toolCallBlocksById.set(toolCall.id, block);
  }
  state.blocks.push(block);
  state.events.push({
    contentIndex: state.blocks.indexOf(block),
    partial: state.output,
    type: "toolcall_start",
  });
  return block;
}

function linkToolCallBlock(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  block: openaiCompletionsStreamTypesModule.StreamingToolCallBlock,
  toolCall: openaiCompletionsStreamTypesModule.StreamingToolCallDelta,
  streamIndex: number | undefined,
): void {
  if (streamIndex !== undefined && block.streamIndex === undefined) {
    block.streamIndex = streamIndex;
    state.toolCallBlocksByIndex.set(streamIndex, block);
  }
  if (toolCall.id !== undefined && toolCall.id !== "") {
    state.toolCallBlocksById.set(toolCall.id, block);
  }
}

function adoptCustomInput(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
  block: openaiCompletionsStreamTypesModule.StreamingToolCallBlock,
  toolCall: openaiCompletionsStreamTypesModule.StreamingToolCallDelta,
): void {
  if (!isCustomToolCall(toolCall) || block.customInput !== undefined) return;
  const customInputProperty = state.grammarToolInputProperties.get(block.name) ?? "input";
  block.arguments = { [customInputProperty]: "" };
  block.customInput = { jsonBuffer: emptyJsonBuffer(), property: customInputProperty };
  delete block.partialArgs;
}

function ensureToolCallBlock(input: {
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState;
  toolCall: openaiCompletionsStreamTypesModule.StreamingToolCallDelta;
}): openaiCompletionsStreamTypesModule.StreamingToolCallBlock {
  const { state, toolCall } = input;
  const streamIndex = typeof toolCall.index === "number" ? toolCall.index : undefined;
  const name = toolCall.function?.name ?? toolCall.custom?.name ?? "";
  const existing = findToolCallBlock(state, toolCall, streamIndex);
  const block = existing ?? registerToolCallBlock(state, toolCall, streamIndex, name);
  linkToolCallBlock(state, block, toolCall, streamIndex);
  if (block.name === "" && name !== "") block.name = name;
  adoptCustomInput(state, block, toolCall);
  return block;
}

const openaiCompletionsStreamToolCalls = {
  appendCustomToolCallInput,
  ensureToolCallBlock,
  getCustomToolCallInput,
};

export default openaiCompletionsStreamToolCalls;
