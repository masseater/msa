import type { ResponseOutputItem } from "openai/resources/responses/responses.js";

import type {
  Api,
  AssistantMessage,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import {
  appendGrammarToolInputJsonDelta,
  type GrammarToolInputJsonBuffer,
} from "./constrained-sampling.ts";
import type { OpenAIResponsesStreamOptions } from "./openai-responses-options.ts";

export type StreamingToolCall = ToolCall & {
  partialJson?: string;
  customInput?: { property: string; jsonBuffer: GrammarToolInputJsonBuffer };
};

type SlotBody =
  | { readonly type: "thinking"; readonly block: ThinkingContent }
  | { readonly type: "text"; readonly block: TextContent }
  | { readonly type: "toolCall"; readonly block: StreamingToolCall };

export type ResponsesOutputSlot = SlotBody & { readonly contentIndex: number };

export type ToolCallOutputSlot = Extract<ResponsesOutputSlot, { type: "toolCall" }>;

export interface ResponsesStreamState<TApi extends Api> {
  readonly output: AssistantMessage;
  readonly stream: AssistantMessageEventStream;
  readonly model: Model<TApi>;
  readonly options: OpenAIResponsesStreamOptions | undefined;
  readonly slots: Map<number, ResponsesOutputSlot>;
  readonly reasoningBlocksById: Map<string, ThinkingContent>;
  sawTerminalResponseEvent: boolean;
}

export function applyMessagePhaseStopReason(output: AssistantMessage) {
  return (item: ResponseOutputItem): void => {
    if (item.type === "message" && item.phase === "final_answer") output.stopReason = "stop";
  };
}

function slotBody<TApi extends Api>(
  state: ResponsesStreamState<TApi>,
  item: ResponseOutputItem,
): SlotBody | undefined {
  switch (item.type) {
    case "reasoning":
      return { type: "thinking", block: { type: "thinking", thinking: "" } };
    case "message":
      applyMessagePhaseStopReason(state.output)(item);
      return { type: "text", block: { type: "text", text: "" } };
    case "function_call":
      return {
        type: "toolCall",
        block: {
          type: "toolCall",
          id: `${item.call_id}|${item.id}`,
          name: item.name,
          arguments: {},
          ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
          partialJson: item.arguments || "",
        },
      };
    case "custom_tool_call": {
      const property = state.options?.grammarToolInputProperties?.get(item.name) ?? "input";
      return {
        type: "toolCall",
        block: {
          type: "toolCall",
          id: `${item.call_id}|${item.id}`,
          name: item.name,
          arguments: { [property]: item.input || "" },
          ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
          customInput: { property, jsonBuffer: { input: "", started: false, closed: false } },
        },
      };
    }
    default:
      return undefined;
  }
}

const START_EVENT = {
  thinking: "thinking_start",
  text: "text_start",
  toolCall: "toolcall_start",
} as const;

export function openSlot<TApi extends Api>(state: ResponsesStreamState<TApi>) {
  return (outputIndex: number, item: ResponseOutputItem): ResponsesOutputSlot | undefined => {
    const body = slotBody(state, item);
    if (body === undefined) return undefined;
    state.output.content.push(body.block);
    const slot: ResponsesOutputSlot = { ...body, contentIndex: state.output.content.length - 1 };
    state.slots.set(outputIndex, slot);
    state.stream.push({
      type: START_EVENT[slot.type],
      contentIndex: slot.contentIndex,
      partial: state.output,
    });
    return slot;
  };
}

export function slotOf<TApi extends Api>(state: ResponsesStreamState<TApi>) {
  return <TType extends ResponsesOutputSlot["type"]>(
    outputIndex: number,
    type: TType,
  ): Extract<ResponsesOutputSlot, { type: TType }> | undefined => {
    const slot = state.slots.get(outputIndex);
    return slot?.type === type
      ? (slot as Extract<ResponsesOutputSlot, { type: TType }>)
      : undefined;
  };
}

export function pushToolCallDelta<TApi extends Api>(state: ResponsesStreamState<TApi>) {
  return (slot: ToolCallOutputSlot, delta: string | undefined): void => {
    if (delta === undefined) return;
    state.stream.push({
      type: "toolcall_delta",
      contentIndex: slot.contentIndex,
      delta,
      partial: state.output,
    });
  };
}

export function customToolCallInput(block: StreamingToolCall): string {
  const property = block.customInput?.property;
  if (property === undefined) return "";
  const value = block.arguments[property];
  return typeof value === "string" ? value : "";
}

export interface CustomInputUpdate {
  readonly block: StreamingToolCall;
  readonly nextInput: string;
  readonly close: boolean;
}

export function appendCustomToolCallInput({
  block,
  nextInput,
  close,
}: CustomInputUpdate): string | undefined {
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
