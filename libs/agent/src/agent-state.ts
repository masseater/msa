import {
  createInitialSystemMessage,
  getCurrentSystemPrompt,
  type ImageContent,
  type Message,
  type Model,
  type TextContent,
  toToolDeclaration,
} from "@msa/ai";

import { now } from "./call.ts";
import type { AgentEvent, AgentMessage, AgentState, AgentTool } from "./types.ts";

export const defaultConvertToLlm = (messages: AgentMessage[]): Message[] =>
  messages.filter(
    (message) =>
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult",
  );

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const DEFAULT_MODEL = {
  id: "unknown",
  name: "unknown",
  api: "unknown",
  provider: "unknown",
  baseUrl: "",
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
} satisfies Model<any>;

export type MutableAgentState = Omit<
  AgentState,
  "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"
> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage | undefined;
  pendingToolCalls: Set<string>;
  errorMessage?: string | undefined;
};

export type AgentInitialState = Partial<
  Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">
>;

export const createMutableAgentState = (initialState?: AgentInitialState): MutableAgentState => {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];
  const initialMessage = createInitialSystemMessage(
    initialState?.systemPrompt,
    tools.map(toToolDeclaration),
  );
  if (messages[0]?.role !== "system" && initialMessage !== undefined) {
    messages.unshift(initialMessage);
  }

  return {
    get systemPrompt() {
      return getCurrentSystemPrompt(messages);
    },
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? "off",
    get tools() {
      return tools;
    },
    set tools(nextTools: AgentTool<any>[]) {
      tools = nextTools.slice();
    },
    get messages() {
      return messages;
    },
    set messages(nextMessages: AgentMessage[]) {
      messages = nextMessages.slice();
    },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
};

export interface PromptInput {
  readonly input: string | AgentMessage | AgentMessage[];
  readonly images: ImageContent[] | undefined;
}

export const promptMessages = ({ input, images }: PromptInput): AgentMessage[] => {
  if (Array.isArray(input)) return input;
  if (typeof input !== "string") return [input];
  const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
  if (images !== undefined && images.length > 0) content.push(...images);
  return [{ role: "user", content, timestamp: now() }];
};

export interface RunFailure {
  readonly model: Model<any>;
  readonly error: unknown;
  readonly aborted: boolean;
}

export const runFailureMessage = ({ model, error, aborted }: RunFailure) =>
  ({
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: aborted ? "aborted" : "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: now(),
  }) satisfies AgentMessage;

const withPending = (state: MutableAgentState, update: (pending: Set<string>) => void): void => {
  const pendingToolCalls = new Set(state.pendingToolCalls);
  update(pendingToolCalls);
  state.pendingToolCalls = pendingToolCalls;
};

export interface StateEvent {
  readonly state: MutableAgentState;
  readonly event: AgentEvent;
}

export const reduceAgentEvent = ({ state, event }: StateEvent): void => {
  switch (event.type) {
    case "message_start":
    case "message_update":
      state.streamingMessage = event.message;
      break;
    case "message_end":
      state.streamingMessage = undefined;
      state.messages.push(event.message);
      break;
    case "tool_execution_start":
      withPending(state, (pending) => pending.add(event.toolCallId));
      break;
    case "tool_execution_end":
      withPending(state, (pending) => pending.delete(event.toolCallId));
      break;
    case "turn_end":
      if (
        event.message.role === "assistant" &&
        event.message.errorMessage !== undefined &&
        event.message.errorMessage !== ""
      ) {
        state.errorMessage = event.message.errorMessage;
      }
      break;
    case "agent_end":
      state.streamingMessage = undefined;
      break;
    default:
      break;
  }
};
