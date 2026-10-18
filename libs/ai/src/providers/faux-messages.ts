import { Function } from "effect";

import type {
  AssistantMessage,
  DeferredHandle,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { nextRandom } from "../utils/random.ts";

export const DEFAULT_API = "faux";
export const DEFAULT_PROVIDER = "faux";
export const DEFAULT_MODEL_ID = "faux-1";
export const DEFAULT_MODEL_NAME = "Faux Model";
export const DEFAULT_BASE_URL = "http://localhost:0";
export const DEFAULT_MIN_TOKEN_SIZE = 3;
export const DEFAULT_MAX_TOKEN_SIZE = 5;

export const DEFAULT_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function randomId(prefix: string): string {
  return `${prefix}:${currentTimeMillis()}:${nextRandom().toString(36).slice(2)}`;
}

export type FauxContentBlock = TextContent | ThinkingContent | ToolCall;

export function fauxText(text: string): TextContent {
  return { type: "text", text };
}

export function fauxThinking(thinking: string): ThinkingContent {
  return { type: "thinking", thinking };
}

export const fauxToolCall: {
  (arguments_: ToolCall["arguments"], options?: { id?: string }): (name: string) => ToolCall;
  (name: string, arguments_: ToolCall["arguments"], options?: { id?: string }): ToolCall;
} = Function.dual(
  (args) => typeof args[0] === "string",
  function (
    name: string,
    arguments_: ToolCall["arguments"],
    options: { id?: string } = {},
  ): ToolCall {
    return {
      type: "toolCall",
      id: options.id ?? randomId("tool"),
      name,
      arguments: arguments_,
    };
  },
);

function normalizeFauxAssistantContent(
  content: string | FauxContentBlock | FauxContentBlock[],
): FauxContentBlock[] {
  if (typeof content === "string") {
    return [fauxText(content)];
  }
  return Array.isArray(content) ? content : [content];
}

export const fauxAssistantMessage: {
  (options?: {
    stopReason?: AssistantMessage["stopReason"];
    deferred?: DeferredHandle;
    errorMessage?: string;
    responseId?: string;
    timestamp?: number;
  }): (content: string | FauxContentBlock | FauxContentBlock[]) => AssistantMessage;
  (
    content: string | FauxContentBlock | FauxContentBlock[],
    options?: {
      stopReason?: AssistantMessage["stopReason"];
      deferred?: DeferredHandle;
      errorMessage?: string;
      responseId?: string;
      timestamp?: number;
    },
  ): AssistantMessage;
} = Function.dual(
  (args) =>
    typeof args[0] === "string" ||
    Array.isArray(args[0]) ||
    (typeof args[0] === "object" && args[0] !== null && "type" in args[0]),
  function (
    content: string | FauxContentBlock | FauxContentBlock[],
    options: {
      stopReason?: AssistantMessage["stopReason"];
      deferred?: DeferredHandle;
      errorMessage?: string;
      responseId?: string;
      timestamp?: number;
    } = {},
  ): AssistantMessage {
    return {
      role: "assistant",
      content: normalizeFauxAssistantContent(content),
      api: DEFAULT_API,
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL_ID,
      usage: DEFAULT_USAGE,
      stopReason: options.stopReason ?? "stop",
      ...(options.deferred === undefined ? {} : { deferred: options.deferred }),
      ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
      ...(options.responseId === undefined ? {} : { responseId: options.responseId }),
      timestamp: options.timestamp ?? currentTimeMillis(),
    };
  },
);

export interface FauxOrigin {
  readonly api: string;
  readonly provider: string;
  readonly modelId: string;
}

export function stampMessage({
  message,
  origin,
}: {
  readonly message: AssistantMessage;
  readonly origin: FauxOrigin;
}): AssistantMessage {
  const cloned = structuredClone(message);
  return {
    ...cloned,
    api: origin.api,
    provider: origin.provider,
    model: origin.modelId,
    timestamp: cloned.timestamp ?? currentTimeMillis(),
    usage: cloned.usage ?? DEFAULT_USAGE,
  };
}

export function deferredMessage({
  model,
  handle,
}: {
  readonly model: Model<string>;
  readonly handle: DeferredHandle;
}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: DEFAULT_USAGE,
    stopReason: "deferred",
    deferred: handle,
    timestamp: currentTimeMillis(),
  };
}

export function errorMessage({
  error,
  origin,
}: {
  readonly error: unknown;
  readonly origin: FauxOrigin;
}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: origin.api,
    provider: origin.provider,
    model: origin.modelId,
    usage: DEFAULT_USAGE,
    stopReason: "error",
    errorMessage: toErrorMessage(error),
    timestamp: currentTimeMillis(),
  };
}

export function abortedMessage(partial: AssistantMessage): AssistantMessage {
  return {
    ...partial,
    stopReason: "aborted",
    errorMessage: "Request was aborted",
    timestamp: currentTimeMillis(),
  };
}
