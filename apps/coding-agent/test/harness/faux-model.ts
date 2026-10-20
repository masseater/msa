import type {
  AssistantMessage,
  JsonObject,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "@msa/ai";
import testing from "@msa/testing";

import type fauxModelTypes from "./faux-model.types.ts";

const { currentTimeMillis } = testing;

const FAUX_PROVIDER = "faux";
const FAUX_MODEL_ID = "faux-1";
const FAUX_API = "anthropic-messages" as const;

const fauxModel: Model<typeof FAUX_API> = {
  api: FAUX_API,
  baseUrl: "http://localhost:0",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: FAUX_MODEL_ID,
  input: ["text", "image"],
  maxTokens: 16384,
  name: "Faux Model",
  provider: FAUX_PROVIDER,
  reasoning: false,
};

const normalizeResponse = (input: fauxModelTypes.FauxResponseInput): fauxModelTypes.FauxResponse =>
  typeof input === "string" ? { text: input } : input;

const buildUsage = (partial?: Partial<Usage>): Usage => {
  const input = partial?.input ?? 100;
  const output = partial?.output ?? 50;
  const cacheRead = partial?.cacheRead ?? 0;
  const cacheWrite = partial?.cacheWrite ?? 0;
  return {
    cacheRead,
    cacheWrite,
    cost: partial?.cost ?? { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input,
    output,
    totalTokens: partial?.totalTokens ?? input + output + cacheRead + cacheWrite,
  };
};

let toolCallIdCounter = 0;

const buildToolCalls = (
  toolCalls: ReadonlyArray<{ id?: string; name: string; args: JsonObject }>,
): ToolCall[] =>
  toolCalls.map((toolCall) => ({
    arguments: toolCall.args,
    id: toolCall.id ?? `faux_tc_${++toolCallIdCounter}`,
    name: toolCall.name,
    type: "toolCall",
  }));

const buildContent = (
  resp: fauxModelTypes.FauxResponse,
): (TextContent | ThinkingContent | ToolCall)[] => {
  const content: (TextContent | ThinkingContent | ToolCall)[] = [];
  if (resp.thinking !== undefined) content.push({ thinking: resp.thinking, type: "thinking" });
  if (resp.text !== undefined) content.push({ text: resp.text, type: "text" });
  if (resp.toolCalls !== undefined) content.push(...buildToolCalls(resp.toolCalls));
  if (content.length === 0 && resp.error === undefined) content.push({ text: "", type: "text" });
  return content;
};

const buildStopReason = (resp: fauxModelTypes.FauxResponse): StopReason => {
  if (resp.stopReason !== undefined) return resp.stopReason;
  if (resp.error !== undefined) return "error";
  if (resp.toolCalls !== undefined && resp.toolCalls.length > 0) return "toolUse";
  return "stop";
};

const buildAssistantMessage = (resp: fauxModelTypes.FauxResponse): AssistantMessage => ({
  api: FAUX_API,
  content: buildContent(resp),
  model: resp.model?.id ?? FAUX_MODEL_ID,
  provider: resp.model?.provider ?? FAUX_PROVIDER,
  role: "assistant",
  stopReason: buildStopReason(resp),
  usage: buildUsage(resp.usage),
  ...(resp.error === undefined ? {} : { errorMessage: resp.error }),
  timestamp: currentTimeMillis(),
});

const fauxModelModule = {
  buildAssistantMessage,
  fauxModel,
  normalizeResponse,
};

export default fauxModelModule;
