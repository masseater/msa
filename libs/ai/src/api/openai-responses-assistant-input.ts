import type {
  ResponseConfigurationUpdateItemParam,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import hash from "../utils/hash.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import constrainedSampling from "./constrained-sampling.ts";
import type openaiResponsesAssistantInputTypes from "./openai-responses-assistant-input.types.ts";
import openaiResponsesSignature from "./openai-responses-signature.ts";

const { shortHash } = hash;
const { parseTextSignature } = openaiResponsesSignature;
const { sanitizeSurrogates } = sanitizeUnicode;
const { getGrammarToolInput } = constrainedSampling;

type ReasoningEffort = NonNullable<ResponseConfigurationUpdateItemParam.Reasoning["effort"]>;

function configurationUpdate(effort: string): ResponseConfigurationUpdateItemParam {
  return { reasoning: { effort: effort as ReasoningEffort }, type: "configuration_update" };
}

function reasoningItems(block: typesModule.ThinkingContent): ResponseInputItem[] {
  if (block.thinkingSignature === undefined || block.thinkingSignature === "") return [];
  return [JSON.parse(block.thinkingSignature) as ResponseReasoningItem];
}

function replayMessageId(rawId: string | undefined, fallbackId: string): string {
  if (rawId === undefined || rawId === "") return fallbackId;
  return rawId.length > 64 ? `msg_${shortHash(rawId)}` : rawId;
}

function textItem(block: typesModule.TextContent, fallbackId: string): ResponseOutputMessage {
  const signature = parseTextSignature(block.textSignature);
  return {
    content: [{ annotations: [], text: sanitizeSurrogates(block.text), type: "output_text" }],
    id: replayMessageId(signature?.id, fallbackId),
    role: "assistant",
    status: "completed",
    type: "message",
    ...(signature?.phase === undefined ? {} : { phase: signature.phase }),
  };
}

interface ReplayRoute {
  readonly sameModel: boolean;
  readonly differentModel: boolean;
}

interface ToolCallReplay {
  readonly toolCall: typesModule.ToolCall;
  readonly route: ReplayRoute;
  readonly customInputProperty: string | undefined;
}

function toolCallItem({ toolCall, route, customInputProperty }: ToolCallReplay): ResponseInputItem {
  const [callId = "", rawItemId] = toolCall.id.split("|");
  const itemIdPrefix = customInputProperty === undefined ? "fc_" : "ctc_";
  const keepItemId = !route.differentModel && rawItemId?.startsWith(itemIdPrefix) === true;
  const shared = {
    ...(keepItemId ? { id: rawItemId } : {}),
    call_id: callId,
    name: toolCall.name,
    ...(route.sameModel && toolCall.namespace !== undefined
      ? { namespace: toolCall.namespace }
      : {}),
  };
  if (customInputProperty === undefined) {
    return { type: "function_call", ...shared, arguments: JSON.stringify(toolCall.arguments) };
  }
  const input = getGrammarToolInput(toolCall.name, toolCall.arguments, customInputProperty);
  return { type: "custom_tool_call", ...shared, input: sanitizeSurrogates(input) };
}

const fallbackMessageId = (msgIndex: number, textBlockIndex: number): string =>
  textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;

function convertAssistantMessage<TApi extends typesModule.Api>({
  model,
  message,
  msgIndex,
  options,
}: openaiResponsesAssistantInputTypes.AssistantConversion<TApi>): ResponseInput | undefined {
  const sameRoute = message.provider === model.provider && message.api === model.api;
  const route: ReplayRoute = {
    differentModel: sameRoute && message.model !== model.id,
    sameModel: sameRoute && message.model === model.id,
  };
  let textBlockIndex = 0;
  const output = message.content.flatMap((block): ResponseInputItem[] => {
    if (block.type === "thinking") return reasoningItems(block);
    if (block.type === "text")
      return [textItem(block, fallbackMessageId(msgIndex, textBlockIndex++))];
    const customInputProperty = options?.grammarToolInputProperties?.get(block.name);
    return [toolCallItem({ customInputProperty, route, toolCall: block })];
  });
  if (output.length === 0) return undefined;
  const replayEffort =
    options?.configurationUpdateEffort !== undefined && route.sameModel
      ? message.providerThinkingLevel
      : undefined;
  return replayEffort === undefined ? output : [configurationUpdate(replayEffort), ...output];
}

const openaiResponsesAssistantInput = {
  configurationUpdate,
  convertAssistantMessage,
};

export default openaiResponsesAssistantInput;
