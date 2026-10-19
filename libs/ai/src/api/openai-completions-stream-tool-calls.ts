import type { GrammarToolInputJsonBuffer } from "./constrained-sampling.ts";
import { appendGrammarToolInputJsonDelta } from "./constrained-sampling.ts";
import type {
  CompletionsStreamState,
  StreamingToolCallBlock,
  StreamingToolCallDelta,
} from "./openai-completions-stream-types.ts";

function emptyJsonBuffer(): GrammarToolInputJsonBuffer {
  return { input: "", started: false, closed: false };
}

function isCustomToolCall(toolCall: StreamingToolCallDelta): boolean {
  return toolCall.custom !== undefined && toolCall.function === undefined;
}

function getCustomToolCallInput(input: { block: StreamingToolCallBlock }): string {
  const { block } = input;
  const property = block.customInput?.property;
  if (property === undefined) return "";
  const value = block.arguments[property];
  return typeof value === "string" ? value : "";
}

function appendCustomToolCallInput(input: {
  block: StreamingToolCallBlock;
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
  state: CompletionsStreamState,
  toolCall: StreamingToolCallDelta,
  streamIndex: number | undefined,
): StreamingToolCallBlock | undefined {
  const byIndex =
    streamIndex === undefined ? undefined : state.toolCallBlocksByIndex.get(streamIndex);
  if (byIndex !== undefined) return byIndex;
  if (toolCall.id === undefined || toolCall.id === "") return undefined;
  return state.toolCallBlocksById.get(toolCall.id);
}

function registerToolCallBlock(
  state: CompletionsStreamState,
  toolCall: StreamingToolCallDelta,
  streamIndex: number | undefined,
  name: string,
): StreamingToolCallBlock {
  const customInputProperty = isCustomToolCall(toolCall)
    ? (state.grammarToolInputProperties.get(name) ?? "input")
    : undefined;
  const hasCustomInput = customInputProperty !== undefined;
  const block: StreamingToolCallBlock = {
    type: "toolCall",
    id: toolCall.id || "",
    name,
    arguments: hasCustomInput ? { [customInputProperty]: "" } : {},
    partialArgs: hasCustomInput ? undefined : "",
    customInput: hasCustomInput
      ? { property: customInputProperty, jsonBuffer: emptyJsonBuffer() }
      : undefined,
    streamIndex,
  };
  if (streamIndex !== undefined) {
    state.toolCallBlocksByIndex.set(streamIndex, block);
  }
  if (toolCall.id !== undefined && toolCall.id !== "") {
    state.toolCallBlocksById.set(toolCall.id, block);
  }
  state.blocks.push(block);
  state.events.push({
    type: "toolcall_start",
    contentIndex: state.blocks.indexOf(block),
    partial: state.output,
  });
  return block;
}

function linkToolCallBlock(
  state: CompletionsStreamState,
  block: StreamingToolCallBlock,
  toolCall: StreamingToolCallDelta,
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
  state: CompletionsStreamState,
  block: StreamingToolCallBlock,
  toolCall: StreamingToolCallDelta,
): void {
  if (!isCustomToolCall(toolCall) || block.customInput !== undefined) return;
  const customInputProperty = state.grammarToolInputProperties.get(block.name) ?? "input";
  block.arguments = { [customInputProperty]: "" };
  block.customInput = { property: customInputProperty, jsonBuffer: emptyJsonBuffer() };
  delete block.partialArgs;
}

function ensureToolCallBlock(input: {
  state: CompletionsStreamState;
  toolCall: StreamingToolCallDelta;
}): StreamingToolCallBlock {
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

export { appendCustomToolCallInput, ensureToolCallBlock, getCustomToolCallInput };
