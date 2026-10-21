import { Function } from "effect";

import type typesModule from "../types.types.ts";
import clock from "../utils/clock.ts";
import errors from "../utils/errors.ts";
import random from "../utils/random.ts";
import type fauxMessagesTypes from "./faux-messages.types.ts";

const { currentTimeMillis } = clock;
const { nextRandom } = random;
const { toErrorMessage } = errors;

const DEFAULT_API = "faux";
const DEFAULT_PROVIDER = "faux";
const DEFAULT_MODEL_ID = "faux-1";
const DEFAULT_MODEL_NAME = "Faux Model";
const DEFAULT_BASE_URL = "http://localhost:0";
const DEFAULT_MIN_TOKEN_SIZE = 3;
const DEFAULT_MAX_TOKEN_SIZE = 5;

const DEFAULT_USAGE: typesModule.Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

function randomId(prefix: string): string {
  return `${prefix}:${currentTimeMillis()}:${nextRandom().toString(36).slice(2)}`;
}

function fauxText(text: string): typesModule.TextContent {
  return { text, type: "text" };
}

function fauxThinking(thinking: string): typesModule.ThinkingContent {
  return { thinking, type: "thinking" };
}

const fauxToolCall: {
  (
    arguments_: typesModule.ToolCall["arguments"],
    options?: { id?: string },
  ): (name: string) => typesModule.ToolCall;
  (
    name: string,
    arguments_: typesModule.ToolCall["arguments"],
    options?: { id?: string },
  ): typesModule.ToolCall;
} = Function.dual(
  (args) => typeof args[0] === "string",
  function (
    name: string,
    arguments_: typesModule.ToolCall["arguments"],
    options: { id?: string } = {},
  ): typesModule.ToolCall {
    return {
      arguments: arguments_,
      id: options.id ?? randomId("tool"),
      name,
      type: "toolCall",
    };
  },
);

function normalizeFauxAssistantContent(
  content: string | fauxMessagesTypes.FauxContentBlock | fauxMessagesTypes.FauxContentBlock[],
): fauxMessagesTypes.FauxContentBlock[] {
  if (typeof content === "string") {
    return [fauxText(content)];
  }
  return Array.isArray(content) ? content : [content];
}

const fauxAssistantMessage: {
  (options?: {
    stopReason?: typesModule.AssistantMessage["stopReason"];
    deferred?: typesModule.DeferredHandle;
    errorMessage?: string;
    responseId?: string;
    timestamp?: number;
  }): (
    content: string | fauxMessagesTypes.FauxContentBlock | fauxMessagesTypes.FauxContentBlock[],
  ) => typesModule.AssistantMessage;
  (
    content: string | fauxMessagesTypes.FauxContentBlock | fauxMessagesTypes.FauxContentBlock[],
    options?: {
      stopReason?: typesModule.AssistantMessage["stopReason"];
      deferred?: typesModule.DeferredHandle;
      errorMessage?: string;
      responseId?: string;
      timestamp?: number;
    },
  ): typesModule.AssistantMessage;
} = Function.dual(
  (args) =>
    typeof args[0] === "string" ||
    Array.isArray(args[0]) ||
    (typeof args[0] === "object" && args[0] !== null && "type" in args[0]),
  function (
    content: string | fauxMessagesTypes.FauxContentBlock | fauxMessagesTypes.FauxContentBlock[],
    options: {
      stopReason?: typesModule.AssistantMessage["stopReason"];
      deferred?: typesModule.DeferredHandle;
      errorMessage?: string;
      responseId?: string;
      timestamp?: number;
    } = {},
  ): typesModule.AssistantMessage {
    return {
      api: DEFAULT_API,
      content: normalizeFauxAssistantContent(content),
      model: DEFAULT_MODEL_ID,
      provider: DEFAULT_PROVIDER,
      role: "assistant",
      stopReason: options.stopReason ?? "stop",
      timestamp: options.timestamp ?? currentTimeMillis(),
      usage: DEFAULT_USAGE,
      ...(options.deferred === undefined ? {} : { deferred: options.deferred }),
      ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
      ...(options.responseId === undefined ? {} : { responseId: options.responseId }),
    };
  },
);

function stampMessage({
  message,
  origin,
}: {
  readonly message: typesModule.AssistantMessage;
  readonly origin: fauxMessagesTypes.FauxOrigin;
}): typesModule.AssistantMessage {
  const cloned = structuredClone(message);
  return {
    ...cloned,
    api: origin.api,
    model: origin.modelId,
    provider: origin.provider,
    timestamp: cloned.timestamp ?? currentTimeMillis(),
    usage: cloned.usage ?? DEFAULT_USAGE,
  };
}

function deferredMessage({
  model,
  handle,
}: {
  readonly model: typesModule.Model<string>;
  readonly handle: typesModule.DeferredHandle;
}): typesModule.AssistantMessage {
  return {
    api: model.api,
    content: [],
    deferred: handle,
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "deferred",
    timestamp: currentTimeMillis(),
    usage: DEFAULT_USAGE,
  };
}

function errorMessage({
  error,
  origin,
}: {
  readonly error: unknown;
  readonly origin: fauxMessagesTypes.FauxOrigin;
}): typesModule.AssistantMessage {
  return {
    api: origin.api,
    content: [],
    errorMessage: toErrorMessage(error),
    model: origin.modelId,
    provider: origin.provider,
    role: "assistant",
    stopReason: "error",
    timestamp: currentTimeMillis(),
    usage: DEFAULT_USAGE,
  };
}

function abortedMessage(partial: typesModule.AssistantMessage): typesModule.AssistantMessage {
  return {
    ...partial,
    errorMessage: "Request was aborted",
    stopReason: "aborted",
    timestamp: currentTimeMillis(),
  };
}

const fauxMessages = {
  DEFAULT_API,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKEN_SIZE,
  DEFAULT_MIN_TOKEN_SIZE,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_NAME,
  DEFAULT_PROVIDER,
  DEFAULT_USAGE,
  abortedMessage,
  deferredMessage,
  errorMessage,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  randomId,
  stampMessage,
};

export default fauxMessages;
