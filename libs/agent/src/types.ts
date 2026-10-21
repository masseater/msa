import type aiTypes from "@msa/ai/index.types";
import type { Static, TSchema } from "typebox";

declare global {
  interface MsaAgentCustomMessages {}
}

declare namespace typesModule {
  type StreamFn = (
    model: aiTypes.Model<aiTypes.Api>,
    context: aiTypes.TranscriptContext,
    options?: aiTypes.SimpleStreamOptions,
  ) => aiTypes.AssistantMessageEventStream | Promise<aiTypes.AssistantMessageEventStream>;

  type ToolExecutionMode = "sequential" | "parallel";

  type QueueMode = "all" | "one-at-a-time";

  type AgentToolCall = Extract<aiTypes.AssistantMessage["content"][number], { type: "toolCall" }>;

  interface BeforeToolCallResult {
    block?: boolean;
    reason?: string;

    terminate?: boolean;
  }

  interface AfterToolCallResult {
    content?: (aiTypes.TextContent | aiTypes.ImageContent)[];
    details?: unknown;
    structuredContent?: aiTypes.JsonValue;
    isError?: boolean;

    usage?: aiTypes.Usage;

    terminate?: boolean;
  }

  interface BeforeToolCallContext {
    assistantMessage: aiTypes.AssistantMessage;

    toolCall: AgentToolCall;

    args: unknown;

    context: AgentContext;
  }

  interface AfterToolCallContext {
    assistantMessage: aiTypes.AssistantMessage;

    toolCall: AgentToolCall;

    args: unknown;

    result: AgentToolResult<any>;

    isError: boolean;

    context: AgentContext;
  }

  interface AgentTurnContext {
    message: aiTypes.AssistantMessage;

    toolResults: aiTypes.ToolResultMessage[];

    context: AgentContext;

    newMessages: AgentMessage[];
  }

  type AgentTurnDecision = { action: "continue" } | { action: "end" };

  type FinishTurn = (
    turn: AgentTurnContext,
    signal?: AbortSignal,
  ) => AgentTurnDecision | void | Promise<AgentTurnDecision | undefined> | Promise<void>;

  interface AgentLoopTurnUpdate {
    context?: AgentContext;

    messages?: AgentMessage[];

    model?: aiTypes.Model<any>;

    thinkingLevel?: ThinkingLevel;
  }

  interface PrepareRequestContext {
    context: AgentContext;
    model: aiTypes.Model<any>;
    thinkingLevel: ThinkingLevel;
  }

  type AgentRequestUpdate = Omit<AgentLoopTurnUpdate, "messages">;

  type PrepareRequest = (
    request: PrepareRequestContext,
    signal?: AbortSignal,
  ) => AgentRequestUpdate | void | Promise<AgentRequestUpdate | undefined> | Promise<void>;

  interface PrepareNextTurnContext extends AgentTurnContext {}

  interface AgentLoopConfig extends aiTypes.SimpleStreamOptions {
    model: aiTypes.Model<any>;

    convertToLlm: (messages: AgentMessage[]) => aiTypes.Message[] | Promise<aiTypes.Message[]>;

    transformContext?:
      | ((messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>)
      | undefined;

    getApiKey?:
      | ((provider: string) => Promise<string | undefined> | string | undefined)
      | undefined;

    finishTurn?: FinishTurn | undefined;

    prepareRequest?: PrepareRequest | undefined;

    prepareNextTurn?:
      | ((
          context: PrepareNextTurnContext,
        ) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>)
      | undefined;

    getSteeringMessages?: () => Promise<AgentMessage[]>;

    getFollowUpMessages?: () => Promise<AgentMessage[]>;

    toolExecution?: ToolExecutionMode;

    beforeToolCall?:
      | ((
          context: BeforeToolCallContext,
          signal?: AbortSignal,
        ) => Promise<BeforeToolCallResult | undefined>)
      | undefined;

    afterToolCall?:
      | ((
          context: AfterToolCallContext,
          signal?: AbortSignal,
        ) => Promise<AfterToolCallResult | undefined>)
      | undefined;
  }

  type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

  type CustomAgentMessages = MsaAgentCustomMessages;

  type AgentMessage = aiTypes.Message | MsaAgentCustomMessages[keyof MsaAgentCustomMessages];

  interface AgentState {
    readonly systemPrompt: string;

    model: aiTypes.Model<any>;

    thinkingLevel: ThinkingLevel;

    set tools(tools: AgentTool<any>[]);
    get tools(): AgentTool<any>[];

    set messages(messages: AgentMessage[]);
    get messages(): AgentMessage[];

    readonly isStreaming: boolean;

    readonly streamingMessage?: AgentMessage | undefined;

    readonly pendingToolCalls: ReadonlySet<string>;

    readonly errorMessage?: string | undefined;
  }

  interface AgentToolResult<T = aiTypes.JsonValue | undefined> {
    content: (aiTypes.TextContent | aiTypes.ImageContent)[];

    details: T;

    structuredContent?: aiTypes.JsonValue;

    usage?: aiTypes.Usage | undefined;

    isError?: boolean;

    terminate?: boolean | undefined;
  }

  interface AgentToolCallOutcome {
    toolCall: AgentToolCall;
    result: AgentToolResult<any>;
    isError: boolean;

    durationMs?: number;
  }

  type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

  interface AgentTool<
    TParameters extends TSchema = TSchema,
    TDetails = any,
  > extends aiTypes.Tool<TParameters> {
    label: string;

    prepareArguments?: (args: unknown) => Static<TParameters>;

    outputSchema?: TSchema;

    execute: (
      toolCallId: string,
      params: Static<TParameters>,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<TDetails>,
    ) => Promise<AgentToolResult<TDetails>>;

    replay?: "never" | "safe";

    executionMode?: ToolExecutionMode;
  }

  interface AgentContext {
    messages: AgentMessage[];

    tools?: AgentTool<any>[];
  }

  type AgentEvent =
    | { type: "agent_start" }
    | { type: "agent_end"; messages: AgentMessage[] }
    | { type: "turn_start" }
    | { type: "turn_end"; message: AgentMessage; toolResults: aiTypes.ToolResultMessage[] }
    | { type: "message_start"; message: AgentMessage }
    | {
        type: "message_update";
        message: AgentMessage;
        assistantMessageEvent: aiTypes.AssistantMessageEvent;
      }
    | { type: "message_end"; message: AgentMessage }
    | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
    | {
        type: "tool_execution_update";
        toolCallId: string;
        toolName: string;
        args: any;
        partialResult: any;
      }
    | {
        type: "tool_execution_end";
        toolCallId: string;
        toolName: string;
        result: any;
        isError: boolean;

        durationMs?: number;
      };
}

export type { typesModule as default };
