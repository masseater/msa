import type {
  ResponseConfigurationUpdateItemParam,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";

import type {
  Api,
  AssistantMessage,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../types.ts";
import { shortHash } from "../utils/hash.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getGrammarToolInput } from "./constrained-sampling.ts";
import type { ConvertResponsesMessagesOptions } from "./openai-responses-options.ts";
import { parseTextSignature } from "./openai-responses-signature.ts";

type ReasoningEffort = NonNullable<ResponseConfigurationUpdateItemParam.Reasoning["effort"]>;

export function configurationUpdate(effort: string): ResponseConfigurationUpdateItemParam {
  return { type: "configuration_update", reasoning: { effort: effort as ReasoningEffort } };
}

function reasoningItems(block: ThinkingContent): ResponseInputItem[] {
  if (block.thinkingSignature === undefined || block.thinkingSignature === "") return [];
  return [JSON.parse(block.thinkingSignature) as ResponseReasoningItem];
}

function replayMessageId(rawId: string | undefined, fallbackId: string): string {
  if (rawId === undefined || rawId === "") return fallbackId;
  return rawId.length > 64 ? `msg_${shortHash(rawId)}` : rawId;
}

function textItem(block: TextContent, fallbackId: string): ResponseOutputMessage {
  const signature = parseTextSignature(block.textSignature);
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] }],
    status: "completed",
    id: replayMessageId(signature?.id, fallbackId),
    ...(signature?.phase === undefined ? {} : { phase: signature.phase }),
  };
}

interface ReplayRoute {
  readonly sameModel: boolean;
  readonly differentModel: boolean;
}

interface ToolCallReplay {
  readonly toolCall: ToolCall;
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

export interface AssistantConversion<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly message: AssistantMessage;
  readonly msgIndex: number;
  readonly options: ConvertResponsesMessagesOptions | undefined;
}

export function convertAssistantMessage<TApi extends Api>({
  model,
  message,
  msgIndex,
  options,
}: AssistantConversion<TApi>): ResponseInput | undefined {
  const sameRoute = message.provider === model.provider && message.api === model.api;
  const route: ReplayRoute = {
    sameModel: sameRoute && message.model === model.id,
    differentModel: sameRoute && message.model !== model.id,
  };
  let textBlockIndex = 0;
  const output = message.content.flatMap((block): ResponseInputItem[] => {
    if (block.type === "thinking") return reasoningItems(block);
    if (block.type === "text")
      return [textItem(block, fallbackMessageId(msgIndex, textBlockIndex++))];
    const customInputProperty = options?.grammarToolInputProperties?.get(block.name);
    return [toolCallItem({ toolCall: block, route, customInputProperty })];
  });
  if (output.length === 0) return undefined;
  const replayEffort =
    options?.configurationUpdateEffort !== undefined && route.sameModel
      ? message.providerThinkingLevel
      : undefined;
  return replayEffort === undefined ? output : [configurationUpdate(replayEffort), ...output];
}
