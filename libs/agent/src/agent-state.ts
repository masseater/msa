import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type agentStateTypes from "./agent-state.types.ts";
import callModule from "./call.ts";
import type typesModule from "./types.ts";

const { createInitialSystemMessage, getCurrentSystemPrompt, toToolDeclaration } = ai;

const { now } = callModule;

const defaultConvertToLlm = (messages: typesModule.AgentMessage[]): aiTypes.Message[] =>
  messages.filter(
    (message) =>
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult",
  );

const EMPTY_USAGE = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const DEFAULT_MODEL = {
  api: "unknown",
  baseUrl: "",
  contextWindow: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "unknown",
  input: [],
  maxTokens: 0,
  name: "unknown",
  provider: "unknown",
  reasoning: false,
} satisfies aiTypes.Model<any>;

const createMutableAgentState = (
  initialState?: agentStateTypes.AgentInitialState,
): agentStateTypes.MutableAgentState => {
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
    errorMessage: undefined,
    isStreaming: false,
    get messages() {
      return messages;
    },
    set messages(nextMessages: typesModule.AgentMessage[]) {
      messages = nextMessages.slice();
    },
    model: initialState?.model ?? DEFAULT_MODEL,
    pendingToolCalls: new Set<string>(),
    streamingMessage: undefined,
    get systemPrompt() {
      return getCurrentSystemPrompt(messages);
    },
    thinkingLevel: initialState?.thinkingLevel ?? "off",
    get tools() {
      return tools;
    },
    set tools(nextTools: typesModule.AgentTool<any>[]) {
      tools = nextTools.slice();
    },
  };
};

const promptMessages = ({
  input,
  images,
}: agentStateTypes.PromptInput): typesModule.AgentMessage[] => {
  if (Array.isArray(input)) return input;
  if (typeof input !== "string") return [input];
  const content: Array<aiTypes.TextContent | aiTypes.ImageContent> = [
    { text: input, type: "text" },
  ];
  if (images !== undefined && images.length > 0) content.push(...images);
  return [{ content, role: "user", timestamp: now() }];
};

const runFailureMessage = ({ model, error, aborted }: agentStateTypes.RunFailure) =>
  ({
    api: model.api,
    content: [{ text: "", type: "text" }],
    errorMessage: error instanceof Error ? error.message : String(error),
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: aborted ? "aborted" : "error",
    timestamp: now(),
    usage: EMPTY_USAGE,
  }) satisfies typesModule.AgentMessage;

const withPending = (
  state: agentStateTypes.MutableAgentState,
  update: (pending: Set<string>) => void,
): void => {
  const pendingToolCalls = new Set(state.pendingToolCalls);
  update(pendingToolCalls);
  state.pendingToolCalls = pendingToolCalls;
};

const reduceAgentEvent = ({ state, event }: agentStateTypes.StateEvent): void => {
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

const agentState = {
  createMutableAgentState,
  defaultConvertToLlm,
  promptMessages,
  reduceAgentEvent,
  runFailureMessage,
};

export default agentState;
