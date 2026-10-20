import type { ResponseOutputItem } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import constrainedSampling from "./constrained-sampling.ts";
import type openaiResponsesStreamStateTypes from "./openai-responses-stream-state.types.ts";

const { appendGrammarToolInputJsonDelta } = constrainedSampling;

function applyMessagePhaseStopReason(output: typesModule.AssistantMessage) {
  return (item: ResponseOutputItem): void => {
    if (item.type === "message" && item.phase === "final_answer") output.stopReason = "stop";
  };
}

function slotBody<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  item: ResponseOutputItem,
): openaiResponsesStreamStateTypes.SlotBody | undefined {
  switch (item.type) {
    case "reasoning":
      return { block: { thinking: "", type: "thinking" }, type: "thinking" };
    case "message":
      applyMessagePhaseStopReason(state.output)(item);
      return { block: { text: "", type: "text" }, type: "text" };
    case "function_call":
      return {
        block: {
          arguments: {},
          id: `${item.call_id}|${item.id}`,
          name: item.name,
          partialJson: item.arguments || "",
          type: "toolCall",
          ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
        },
        type: "toolCall",
      };
    case "custom_tool_call": {
      const property = state.options?.grammarToolInputProperties?.get(item.name) ?? "input";
      return {
        block: {
          arguments: { [property]: item.input || "" },
          customInput: { jsonBuffer: { closed: false, input: "", started: false }, property },
          id: `${item.call_id}|${item.id}`,
          name: item.name,
          type: "toolCall",
          ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
        },
        type: "toolCall",
      };
    }
    default:
      return undefined;
  }
}

const START_EVENT = {
  text: "text_start",
  thinking: "thinking_start",
  toolCall: "toolcall_start",
} as const;

function openSlot<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
) {
  return (
    outputIndex: number,
    item: ResponseOutputItem,
  ): openaiResponsesStreamStateTypes.ResponsesOutputSlot | undefined => {
    const body = slotBody(state, item);
    if (body === undefined) return undefined;
    state.output.content.push(body.block);
    const slot: openaiResponsesStreamStateTypes.ResponsesOutputSlot = {
      ...body,
      contentIndex: state.output.content.length - 1,
    };
    state.slots.set(outputIndex, slot);
    state.stream.push({
      contentIndex: slot.contentIndex,
      partial: state.output,
      type: START_EVENT[slot.type],
    });
    return slot;
  };
}

function slotOf<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
) {
  return <TType extends openaiResponsesStreamStateTypes.ResponsesOutputSlot["type"]>(
    outputIndex: number,
    type: TType,
  ): Extract<openaiResponsesStreamStateTypes.ResponsesOutputSlot, { type: TType }> | undefined => {
    const slot = state.slots.get(outputIndex);
    return slot?.type === type
      ? (slot as Extract<openaiResponsesStreamStateTypes.ResponsesOutputSlot, { type: TType }>)
      : undefined;
  };
}

function pushToolCallDelta<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
) {
  return (
    slot: openaiResponsesStreamStateTypes.ToolCallOutputSlot,
    delta: string | undefined,
  ): void => {
    if (delta === undefined) return;
    state.stream.push({
      contentIndex: slot.contentIndex,
      delta,
      partial: state.output,
      type: "toolcall_delta",
    });
  };
}

function customToolCallInput(block: openaiResponsesStreamStateTypes.StreamingToolCall): string {
  const property = block.customInput?.property;
  if (property === undefined) return "";
  const value = block.arguments[property];
  return typeof value === "string" ? value : "";
}

function appendCustomToolCallInput({
  block,
  nextInput,
  close,
}: openaiResponsesStreamStateTypes.CustomInputUpdate): string | undefined {
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

const openaiResponsesStreamState = {
  appendCustomToolCallInput,
  applyMessagePhaseStopReason,
  customToolCallInput,
  openSlot,
  pushToolCallDelta,
  slotOf,
};

export default openaiResponsesStreamState;
