import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import jsonParse from "../utils/json-parse.ts";
import openaiResponsesFinalize from "./openai-responses-finalize.ts";
import openaiResponsesItemDone from "./openai-responses-item-done.ts";
import openaiResponsesStreamState from "./openai-responses-stream-state.ts";
import type openaiResponsesStreamStateTypes from "./openai-responses-stream-state.types.ts";

const { appendCustomToolCallInput, customToolCallInput, openSlot, pushToolCallDelta, slotOf } =
  openaiResponsesStreamState;
const { parseStreamingJson } = jsonParse;
const { completeOutputItem } = openaiResponsesItemDone;
const { finalizeResponse } = openaiResponsesFinalize;

type EventOf<TType extends ResponseStreamEvent["type"]> = Extract<
  ResponseStreamEvent,
  { type: TType }
>;

function appendThinking<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  outputIndex: number,
  delta: string,
): void {
  const slot = slotOf(state)(outputIndex, "thinking");
  if (slot === undefined) return;
  slot.block.thinking += delta;
  const event = { contentIndex: slot.contentIndex, delta, partial: state.output };
  state.stream.push({ type: "thinking_delta", ...event });
}

function appendText<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  outputIndex: number,
  delta: string,
): void {
  const slot = slotOf(state)(outputIndex, "text");
  if (slot === undefined) return;
  slot.block.text += delta;
  state.stream.push({
    contentIndex: slot.contentIndex,
    delta,
    partial: state.output,
    type: "text_delta",
  });
}

function functionArgumentsDelta<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  event: EventOf<"response.function_call_arguments.delta">,
): void {
  const slot = slotOf(state)(event.output_index, "toolCall");
  if (slot?.block.partialJson === undefined) return;
  slot.block.partialJson += event.delta;
  slot.block.arguments = parseStreamingJson(slot.block.partialJson);
  pushToolCallDelta(state)(slot, event.delta);
}

function functionArgumentsDone<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  event: EventOf<"response.function_call_arguments.done">,
): void {
  const slot = slotOf(state)(event.output_index, "toolCall");
  if (slot?.block.partialJson === undefined) return;
  const previous = slot.block.partialJson;
  slot.block.partialJson = event.arguments;
  slot.block.arguments = parseStreamingJson(event.arguments);
  if (!event.arguments.startsWith(previous)) return;
  const delta = event.arguments.slice(previous.length);
  if (delta.length > 0) pushToolCallDelta(state)(slot, delta);
}

function customInput<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  outputIndex: number,
  next: { readonly delta?: string; readonly input?: string },
): void {
  const slot = slotOf(state)(outputIndex, "toolCall");
  if (slot?.block.customInput === undefined) return;
  const nextInput = next.input ?? customToolCallInput(slot.block) + (next.delta ?? "");
  const close = next.input !== undefined;
  pushToolCallDelta(state)(
    slot,
    appendCustomToolCallInput({ block: slot.block, close, nextInput }),
  );
}

function failedResponseMessage(event: EventOf<"response.failed">): string {
  const error = event.response?.error;
  if (error !== null) return `${error.code || "unknown"}: ${error.message || "no message"}`;
  const reason = event.response?.incomplete_details?.reason;
  return reason === undefined
    ? "Unknown error (no error details in response)"
    : `incomplete: ${reason}`;
}

function handleResponsesEvent<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
) {
  return (event: ResponseStreamEvent): void => {
    switch (event.type) {
      case "response.created":
        state.output.responseId = event.response.id;
        return;
      case "response.output_item.added":
        openSlot(state)(event.output_index, event.item);
        return;
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        return appendThinking(state, event.output_index, event.delta);
      case "response.reasoning_summary_part.done":
        return appendThinking(state, event.output_index, "\n\n");
      case "response.output_text.delta":
      case "response.refusal.delta":
        return appendText(state, event.output_index, event.delta);
      case "response.function_call_arguments.delta":
        return functionArgumentsDelta(state, event);
      case "response.function_call_arguments.done":
        return functionArgumentsDone(state, event);
      case "response.custom_tool_call_input.delta":
        return customInput(state, event.output_index, { delta: event.delta });
      case "response.custom_tool_call_input.done":
        return customInput(state, event.output_index, { input: event.input });
      case "response.output_item.done":
        return completeOutputItem(state)(event.output_index, event.item);
      case "response.completed":
      case "response.incomplete":
        return finalizeResponse(state)(event.response);
      case "error":
        throw new Error(`Error Code ${event.code}: ${event.message}`);
      case "response.failed":
        state.output.rawStopReason = event.response?.status;
        throw new Error(failedResponseMessage(event));
    }
  };
}

const openaiResponsesEvents = {
  handleResponsesEvent,
};

export default openaiResponsesEvents;
