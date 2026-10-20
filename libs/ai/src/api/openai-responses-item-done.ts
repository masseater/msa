import type {
  ResponseCustomToolCall,
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import jsonParse from "../utils/json-parse.ts";
import openaiResponsesSignature from "./openai-responses-signature.ts";
import openaiResponsesStreamState from "./openai-responses-stream-state.ts";
import type openaiResponsesStreamStateTypes from "./openai-responses-stream-state.types.ts";

const { encodeTextSignatureV1 } = openaiResponsesSignature;
const { parseToolCallArguments } = jsonParse;
const {
  appendCustomToolCallInput,
  applyMessagePhaseStopReason,
  customToolCallInput,
  openSlot,
  pushToolCallDelta,
} = openaiResponsesStreamState;

type SlotOf<TType extends openaiResponsesStreamStateTypes.ResponsesOutputSlot["type"]> = Extract<
  openaiResponsesStreamStateTypes.ResponsesOutputSlot,
  { type: TType }
>;

interface Completion<
  TApi extends typesModule.Api,
  TItem,
  TType extends openaiResponsesStreamStateTypes.ResponsesOutputSlot["type"],
> {
  readonly state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>;
  readonly item: TItem;
  readonly slot: SlotOf<TType>;
}

function finishThinking<TApi extends typesModule.Api>({
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
    content: slot.block.thinking,
    contentIndex: slot.contentIndex,
    partial: state.output,
    type: "thinking_end",
  });
}

function finishText<TApi extends typesModule.Api>({
  state,
  item,
  slot,
}: Completion<TApi, ResponseOutputMessage, "text">): void {
  slot.block.text =
    item.content?.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("") || "";
  slot.block.textSignature = encodeTextSignatureV1({ id: item.id, phase: item.phase ?? undefined });
  state.stream.push({
    content: slot.block.text,
    contentIndex: slot.contentIndex,
    partial: state.output,
    type: "text_end",
  });
}

function endToolCall<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  slot: openaiResponsesStreamStateTypes.ToolCallOutputSlot,
): void {
  state.stream.push({
    contentIndex: slot.contentIndex,
    partial: state.output,
    toolCall: slot.block,
    type: "toolcall_end",
  });
}

function finishFunctionCall<TApi extends typesModule.Api>({
  state,
  item,
  slot,
}: Completion<TApi, ResponseFunctionToolCall, "toolCall">): void {
  Object.assign(slot.block, parseToolCallArguments(item.arguments || slot.block.partialJson || ""));
  if (item.namespace !== undefined) slot.block.namespace = item.namespace;
  delete slot.block.partialJson;
  endToolCall(state, slot);
}

function finishCustomToolCall<TApi extends typesModule.Api>({
  state,
  item,
  slot,
}: Completion<TApi, ResponseCustomToolCall, "toolCall">): void {
  const nextInput = item.input ?? customToolCallInput(slot.block);
  pushToolCallDelta(state)(
    slot,
    appendCustomToolCallInput({ block: slot.block, close: true, nextInput }),
  );
  if (item.namespace !== undefined) slot.block.namespace = item.namespace;
  delete slot.block.customInput;
  endToolCall(state, slot);
}

function finishItem<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  item: ResponseOutputItem,
  slot: openaiResponsesStreamStateTypes.ResponsesOutputSlot,
): boolean {
  if (item.type === "reasoning" && slot.type === "thinking") {
    finishThinking({ item, slot, state });
  } else if (item.type === "message" && slot.type === "text") {
    finishText({ item, slot, state });
  } else if (item.type === "function_call" && slot.type === "toolCall") {
    if (slot.block.partialJson === undefined) return false;
    finishFunctionCall({ item, slot, state });
  } else if (item.type === "custom_tool_call" && slot.type === "toolCall") {
    if (slot.block.customInput === undefined) return false;
    finishCustomToolCall({ item, slot, state });
  } else {
    return false;
  }
  return true;
}

function completeOutputItem<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
) {
  return (outputIndex: number, item: ResponseOutputItem): void => {
    applyMessagePhaseStopReason(state.output)(item);
    const slot = state.slots.get(outputIndex) ?? openSlot(state)(outputIndex, item);
    if (slot !== undefined && finishItem(state, item, slot)) state.slots.delete(outputIndex);
  };
}

const openaiResponsesItemDone = {
  completeOutputItem,
};

export default openaiResponsesItemDone;
