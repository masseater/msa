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
import { currentTimeMillis } from "@msa/testing";

const FAUX_PROVIDER = "faux";
const FAUX_MODEL_ID = "faux-1";
const FAUX_API = "anthropic-messages" as const;

export const fauxModel: Model<typeof FAUX_API> = {
  id: FAUX_MODEL_ID,
  name: "Faux Model",
  api: FAUX_API,
  provider: FAUX_PROVIDER,
  baseUrl: "http://localhost:0",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

export interface FauxResponse {
  text?: string;
  toolCalls?: Array<{ id?: string; name: string; args: JsonObject }>;
  thinking?: string;
  stopReason?: StopReason;
  error?: string;
  usage?: Partial<Usage>;
  delayMs?: number;
  model?: { provider?: string; id?: string };
}

export type FauxResponseInput = FauxResponse | string;

export const normalizeResponse = (input: FauxResponseInput): FauxResponse =>
  typeof input === "string" ? { text: input } : input;

const buildUsage = (partial?: Partial<Usage>): Usage => {
  const input = partial?.input ?? 100;
  const output = partial?.output ?? 50;
  const cacheRead = partial?.cacheRead ?? 0;
  const cacheWrite = partial?.cacheWrite ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: partial?.totalTokens ?? input + output + cacheRead + cacheWrite,
    cost: partial?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
};

let toolCallIdCounter = 0;

const buildToolCalls = (
  toolCalls: ReadonlyArray<{ id?: string; name: string; args: JsonObject }>,
): ToolCall[] =>
  toolCalls.map((toolCall) => ({
    type: "toolCall",
    id: toolCall.id ?? `faux_tc_${++toolCallIdCounter}`,
    name: toolCall.name,
    arguments: toolCall.args,
  }));

const buildContent = (resp: FauxResponse): (TextContent | ThinkingContent | ToolCall)[] => {
  const content: (TextContent | ThinkingContent | ToolCall)[] = [];
  if (resp.thinking !== undefined) content.push({ type: "thinking", thinking: resp.thinking });
  if (resp.text !== undefined) content.push({ type: "text", text: resp.text });
  if (resp.toolCalls !== undefined) content.push(...buildToolCalls(resp.toolCalls));
  if (content.length === 0 && resp.error === undefined) content.push({ type: "text", text: "" });
  return content;
};

const buildStopReason = (resp: FauxResponse): StopReason => {
  if (resp.stopReason !== undefined) return resp.stopReason;
  if (resp.error !== undefined) return "error";
  if (resp.toolCalls !== undefined && resp.toolCalls.length > 0) return "toolUse";
  return "stop";
};

export const buildAssistantMessage = (resp: FauxResponse): AssistantMessage => ({
  role: "assistant",
  content: buildContent(resp),
  api: FAUX_API,
  provider: resp.model?.provider ?? FAUX_PROVIDER,
  model: resp.model?.id ?? FAUX_MODEL_ID,
  usage: buildUsage(resp.usage),
  stopReason: buildStopReason(resp),
  ...(resp.error === undefined ? {} : { errorMessage: resp.error }),
  timestamp: currentTimeMillis(),
});
