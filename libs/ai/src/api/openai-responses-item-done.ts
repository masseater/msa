import type {
  ResponseCustomToolCall,
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";

import type { Api } from "../types.ts";
import { parseToolCallArguments } from "../utils/json-parse.ts";
import { encodeTextSignatureV1 } from "./openai-responses-signature.ts";
import {
  appendCustomToolCallInput,
  applyMessagePhaseStopReason,
  customToolCallInput,
  openSlot,
  pushToolCallDelta,
  type ResponsesOutputSlot,
  type ResponsesStreamState,
  type ToolCallOutputSlot,
} from "./openai-responses-stream-state.ts";

type SlotOf<TType extends ResponsesOutputSlot["type"]> = Extract<
  ResponsesOutputSlot,
  { type: TType }
>;

interface Completion<TApi extends Api, TItem, TType extends ResponsesOutputSlot["type"]> {
  readonly state: ResponsesStreamState<TApi>;
  readonly item: TItem;
  readonly slot: SlotOf<TType>;
}

function finishThinking<TApi extends Api>({
  state,
  item,
  slot,
}: Completion<TApi, ResponseReasoningItem, "thinking">): void {
  const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
  const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
  slot.block.thinking = summaryText || contentText || slot.block.thinking;
  slot.block.thinkingSignature = JSON.stringify(item);
  state.reasoningBlocksById.set(item.id, slot.block);
  state.stream.push({
    type: "thinking_end",
    contentIndex: slot.contentIndex,
    content: slot.block.thinking,
    partial: state.output,
  });
}

function finishText<TApi extends Api>({
  state,
  item,
  slot,
}: Completion<TApi, ResponseOutputMessage, "text">): void {
  slot.block.text =
    item.content?.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("") || "";
  slot.block.textSignature = encodeTextSignatureV1({ id: item.id, phase: item.phase ?? undefined });
  state.stream.push({
    type: "text_end",
    contentIndex: slot.contentIndex,
    content: slot.block.text,
    partial: state.output,
  });
}

function endToolCall<TApi extends Api>(
  state: ResponsesStreamState<TApi>,
  slot: ToolCallOutputSlot,
): void {
  state.stream.push({
    type: "toolcall_end",
    contentIndex: slot.contentIndex,
    toolCall: slot.block,
    partial: state.output,
  });
}

function finishFunctionCall<TApi extends Api>({
  state,
  item,
  slot,
}: Completion<TApi, ResponseFunctionToolCall, "toolCall">): void {
  Object.assign(slot.block, parseToolCallArguments(item.arguments || slot.block.partialJson || ""));
  if (item.namespace !== undefined) slot.block.namespace = item.namespace;
  delete slot.block.partialJson;
  endToolCall(state, slot);
}

function finishCustomToolCall<TApi extends Api>({
  state,
  item,
  slot,
}: Completion<TApi, ResponseCustomToolCall, "toolCall">): void {
  const nextInput = item.input ?? customToolCallInput(slot.block);
  pushToolCallDelta(state)(
    slot,
    appendCustomToolCallInput({ block: slot.block, nextInput, close: true }),
  );
  if (item.namespace !== undefined) slot.block.namespace = item.namespace;
  delete slot.block.customInput;
  endToolCall(state, slot);
}

function finishItem<TApi extends Api>(
  state: ResponsesStreamState<TApi>,
  item: ResponseOutputItem,
  slot: ResponsesOutputSlot,
): boolean {
  if (item.type === "reasoning" && slot.type === "thinking") {
    finishThinking({ state, item, slot });
  } else if (item.type === "message" && slot.type === "text") {
    finishText({ state, item, slot });
  } else if (item.type === "function_call" && slot.type === "toolCall") {
    if (slot.block.partialJson === undefined) return false;
    finishFunctionCall({ state, item, slot });
  } else if (item.type === "custom_tool_call" && slot.type === "toolCall") {
    if (slot.block.customInput === undefined) return false;
    finishCustomToolCall({ state, item, slot });
  } else {
    return false;
  }
  return true;
}

export function completeOutputItem<TApi extends Api>(state: ResponsesStreamState<TApi>) {
  return (outputIndex: number, item: ResponseOutputItem): void => {
    applyMessagePhaseStopReason(state.output)(item);
    const slot = state.slots.get(outputIndex) ?? openSlot(state)(outputIndex, item);
    if (slot !== undefined && finishItem(state, item, slot)) state.slots.delete(outputIndex);
  };
}
