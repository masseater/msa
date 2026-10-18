import type { TSchema } from "typebox";

import type { JsonObject, IsJsonCompatible, JsonRepresentation, JsonValue } from "./json-types.ts";
import type { ModelThinkingLevel } from "./providers/model-schema.ts";
import type { Api, ProviderId } from "./types.ts";
import type { AssistantMessageDiagnostic } from "./utils/diagnostics.ts";

export interface TextSignatureV1 {
  v: 1;
  id: string;
  phase?: "commentary" | "final_answer";
}

export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string | undefined;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string | undefined;
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;
  thoughtSignature?: string | undefined;
  namespace?: string;
  argumentsError?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number | undefined;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason =
  | "pending"
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
  | "deferred";

export interface DeferredHandle {
  provider: string;
  modelId: string;
  api: string;
  id: string;
  expiresAt?: number;
  pollAfterMs?: number;
  data?: JsonValue;
}

export interface SystemMessage {
  role: "system";
  content: string | TextContent[];
  sections?: Record<string, string | null>;
  toolsAdded?: Tool[];
  toolsRemoved?: ToolReference[];
  timestamp: number;
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: ProviderId;
  model: string;
  responseModel?: string;
  responseId?: string | undefined;
  providerThinkingLevel?: string;
  thinkingLevel?: ModelThinkingLevel;
  diagnostics?: AssistantMessageDiagnostic[];
  usage: Usage;
  stopReason: StopReason;
  deferred?: DeferredHandle;
  errorMessage?: string;
  rawStopReason?: string | undefined;
  endTurn?: boolean;
  timestamp: number;
  durationMs?: number;
}

export interface NestedToolCallRecord {
  id: string;
  name: string;
  arguments?: JsonObject;
  argumentsBytes?: number;
  status: "ok" | "error" | "unfinished";
  durationMs?: number;
  error?: string;
}

export interface NestedToolCalls {
  calls: NestedToolCallRecord[];
  complete: boolean;
}

export type ToolResultMessage<TDetails = JsonValue> =
  IsJsonCompatible<TDetails> extends true
    ? {
        role: "toolResult";
        toolCallId: string;
        toolName: string;
        content: (TextContent | ImageContent)[];
        details?: JsonRepresentation<TDetails>;
        usage?: Usage;
        nestedCalls?: NestedToolCalls;
        isError: boolean;
        timestamp: number;
        durationMs?: number;
      }
    : never;

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export type GrammarFormat = "openai_lark" | "openai_regex";

export type GrammarVariants = Partial<Record<GrammarFormat, string>>;

export type ConstrainedSamplingConfig =
  | {
      type: "json_schema";
      strict: "prefer" | "require";
    }
  | {
      type: "grammar";
      variants: GrammarVariants;
    };

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
  constrainedSampling?: false | ConstrainedSamplingConfig | undefined;
}

export interface ToolReference {
  name: string;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

declare const transcriptContextBrand: unique symbol;

export type TranscriptContext = {
  messages: Message[];
  readonly [transcriptContextBrand]: true;
};

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse" | "deferred">;
      message: AssistantMessage;
    }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };
