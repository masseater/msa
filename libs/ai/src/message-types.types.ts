import type { TSchema } from "typebox";

import type jsonTypesModule from "./json-types.ts";
import type messageTypes from "./message-types.ts";
import type modelSchemaTypes from "./providers/model-schema.types.ts";
import type typesModule from "./types.types.ts";
import type diagnosticsTypes from "./utils/diagnostics.types.ts";

declare namespace messageTypesModule {
  interface TextSignatureV1 {
    v: 1;
    id: string;
    phase?: "commentary" | "final_answer";
  }

  interface TextContent {
    type: "text";
    text: string;
    textSignature?: string | undefined;
  }

  interface ThinkingContent {
    type: "thinking";
    thinking: string;
    thinkingSignature?: string | undefined;
    redacted?: boolean;
  }

  interface ImageContent {
    type: "image";
    data: string;
    mimeType: string;
  }

  interface ToolCall {
    type: "toolCall";
    id: string;
    name: string;
    arguments: jsonTypesModule.JsonObject;
    thoughtSignature?: string | undefined;
    namespace?: string;
    argumentsError?: string;
  }

  interface Usage {
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

  type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

  interface DeferredHandle {
    provider: string;
    modelId: string;
    api: string;
    id: string;
    expiresAt?: number;
    pollAfterMs?: number;
    data?: jsonTypesModule.JsonValue;
  }

  interface SystemMessage {
    role: "system";
    content: string | TextContent[];
    sections?: Record<string, string | null>;
    toolsAdded?: Tool[];
    toolsRemoved?: ToolReference[];
    timestamp: number;
  }

  interface UserMessage {
    role: "user";
    content: string | (TextContent | ImageContent)[];
    timestamp: number;
  }

  interface AssistantMessage {
    role: "assistant";
    content: (TextContent | ThinkingContent | ToolCall)[];
    api: typesModule.Api;
    provider: typesModule.ProviderId;
    model: string;
    responseModel?: string;
    responseId?: string | undefined;
    providerThinkingLevel?: string;
    thinkingLevel?: modelSchemaTypes.ModelThinkingLevel;
    diagnostics?: diagnosticsTypes.AssistantMessageDiagnostic[];
    usage: Usage;
    stopReason: StopReason;
    deferred?: DeferredHandle;
    errorMessage?: string;
    errorStatus?: number;
    errorResetsAt?: number;
    rawStopReason?: string | undefined;
    endTurn?: boolean;
    timestamp: number;
    durationMs?: number;
  }

  interface NestedToolCallRecord {
    id: string;
    name: string;
    arguments?: jsonTypesModule.JsonObject;
    argumentsBytes?: number;
    status: "ok" | "error" | "unfinished";
    durationMs?: number;
    error?: string;
  }

  interface NestedToolCalls {
    calls: NestedToolCallRecord[];
    complete: boolean;
  }

  type ToolResultMessage<TDetails = jsonTypesModule.JsonValue> =
    jsonTypesModule.IsJsonCompatible<TDetails> extends true
      ? {
          role: "toolResult";
          toolCallId: string;
          toolName: string;
          content: (TextContent | ImageContent)[];
          details?: jsonTypesModule.JsonRepresentation<TDetails>;
          usage?: Usage;
          nestedCalls?: NestedToolCalls;
          isError: boolean;
          timestamp: number;
          durationMs?: number;
        }
      : never;

  type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

  type GrammarFormat = "openai_lark" | "openai_regex";

  type GrammarVariants = Partial<Record<GrammarFormat, string>>;

  type ConstrainedSamplingConfig =
    | {
        type: "json_schema";
        strict: "prefer" | "require";
      }
    | {
        type: "grammar";
        variants: GrammarVariants;
      };

  interface Tool<TParameters extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: TParameters;
    constrainedSampling?: false | ConstrainedSamplingConfig | undefined;
  }

  interface ToolReference {
    name: string;
  }

  interface Context {
    systemPrompt?: string;
    messages: Message[];
    tools?: Tool[];
  }

  type TranscriptContext = {
    messages: Message[];
    readonly [messageTypes.transcriptContextBrand]: true;
  };

  type AssistantMessageEvent =
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
}

export type { messageTypesModule as default };
