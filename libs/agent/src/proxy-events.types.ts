import type aiTypes from "@msa/ai/index.types";

declare namespace proxyEventsTypes {
  type ProxyAssistantMessageEvent =
    | { type: "start" }
    | { type: "text_start"; contentIndex: number }
    | { type: "text_delta"; contentIndex: number; delta: string }
    | { type: "text_end"; contentIndex: number; contentSignature?: string }
    | { type: "thinking_start"; contentIndex: number }
    | { type: "thinking_delta"; contentIndex: number; delta: string }
    | { type: "thinking_end"; contentIndex: number; contentSignature?: string }
    | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
    | { type: "toolcall_delta"; contentIndex: number; delta: string }
    | { type: "toolcall_end"; contentIndex: number; toolCall: aiTypes.ToolCall }
    | {
        type: "done";
        reason: Extract<aiTypes.StopReason, "stop" | "length" | "toolUse">;
        usage: aiTypes.AssistantMessage["usage"];
        providerThinkingLevel?: string;
      }
    | {
        type: "error";
        reason: Extract<aiTypes.StopReason, "aborted" | "error">;
        errorMessage?: string | undefined;
        errorStatus?: number | undefined;
        usage: aiTypes.AssistantMessage["usage"];
        providerThinkingLevel?: string;
      };

  type ProxyEventOutcome =
    | { readonly known: true; readonly event: aiTypes.AssistantMessageEvent | undefined }
    | { readonly known: false; readonly type: unknown };

  interface ProxyEventUpdate {
    readonly event: ProxyAssistantMessageEvent;
    readonly partial: aiTypes.AssistantMessage;
  }
}

export type { proxyEventsTypes as default };
