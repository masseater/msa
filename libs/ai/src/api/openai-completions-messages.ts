import { Function } from "effect";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

import type { Message, Model } from "../types.ts";
import {
  resolveTranscript,
  resolveTranscriptTools,
  type TranscriptContext,
} from "../utils/transcript.ts";
import { buildAssistantMessage } from "./openai-completions-assistant.ts";
import type { ResolvedOpenAICompletionsCompat } from "./openai-completions-compat.ts";
import {
  hasToolHistory,
  normalizeToolCallId,
  type ConvertCompletionsMessagesOptions,
  type ConvertState,
} from "./openai-completions-convert-state.ts";
import { convertSystemMessage, convertUserMessage } from "./openai-completions-instruction.ts";
import { convertToolResults } from "./openai-completions-tool-results.ts";
import { transformMessages } from "./transform-messages.ts";

function convertMessageAt(state: ConvertState, messages: Message[], index: number): number {
  const msg = messages[index];
  if (msg === undefined) return index + 1;
  if (
    state.compat.requiresAssistantAfterToolResult &&
    state.lastRole === "toolResult" &&
    msg.role === "user"
  ) {
    state.params.push({ role: "assistant", content: "I have processed the tool results." });
  }

  if (msg.role === "system") {
    convertSystemMessage({ state, msg, index });
  } else if (msg.role === "user") {
    if (!convertUserMessage({ state, msg })) return index + 1;
  } else if (msg.role === "assistant") {
    const assistantMsg = buildAssistantMessage({ state, msg });
    if (assistantMsg === undefined) return index + 1;
    state.params.push(assistantMsg);
  } else if (msg.role === "toolResult") {
    return convertToolResults({ state, messages, index });
  }
  state.lastRole = msg.role;
  return index + 1;
}

const convertMessages: {
  (
    context: TranscriptContext,
    compat: ResolvedOpenAICompletionsCompat,
    options?: ConvertCompletionsMessagesOptions,
  ): (model: Model<"openai-completions">) => ChatCompletionMessageParam[];
  (
    model: Model<"openai-completions">,
    context: TranscriptContext,
    compat: ResolvedOpenAICompletionsCompat,
    options?: ConvertCompletionsMessagesOptions,
  ): ChatCompletionMessageParam[];
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function (
    model: Model<"openai-completions">,
    context: TranscriptContext,
    compat: ResolvedOpenAICompletionsCompat,
    options?: ConvertCompletionsMessagesOptions,
  ): ChatCompletionMessageParam[] {
    const normalizedContext = resolveTranscript(context, compat.supportsMidConvoSystemMessages);
    const transcriptTools = resolveTranscriptTools(
      normalizedContext.messages,
      compat.supportsMidConvoSystemMessages === true &&
        compat.supportsMidConvoToolAdditions === true,
    );
    const state: ConvertState = {
      model,
      compat,
      options,
      instructionRole: model.reasoning && compat.supportsDeveloperRole ? "developer" : "system",
      anchorsAdditions: transcriptTools.anchorsAdditions,
      params: [],
      lastRole: null,
    };
    const transformedMessages = transformMessages(normalizedContext.messages, model, (id) =>
      normalizeToolCallId({ model, id }),
    );
    let index = 0;
    while (index < transformedMessages.length) {
      index = convertMessageAt(state, transformedMessages, index);
    }
    return state.params;
  },
);

export { convertMessages, hasToolHistory, type ConvertCompletionsMessagesOptions };
