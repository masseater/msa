import { Function } from "effect";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import type openaiCompletionsCompatTypes from "./openai-completions-compat.types.ts";
import type openaiCompletionsConvertStateTypes from "./openai-completions-convert-state.types.ts";
import openaiCompletionsInstruction from "./openai-completions-instruction.ts";
import openaiCompletionsMessagesKit from "./openai-completions-messages-kit.ts";
import openaiCompletionsToolResults from "./openai-completions-tool-results.ts";
import transformMessagesModule from "./transform-messages.ts";

const { openaiCompletionsAssistant, openaiCompletionsConvertState, transcript } =
  openaiCompletionsMessagesKit;

const { convertSystemMessage, convertUserMessage } = openaiCompletionsInstruction;
const { buildAssistantMessage } = openaiCompletionsAssistant;
const { convertToolResults } = openaiCompletionsToolResults;
const { resolveTranscript, resolveTranscriptTools } = transcript;
const { transformMessages } = transformMessagesModule;
const { normalizeToolCallId } = openaiCompletionsConvertState;

function convertMessageAt(
  state: openaiCompletionsConvertStateTypes.ConvertState,
  messages: typesModule.Message[],
  index: number,
): number {
  const msg = messages[index];
  if (msg === undefined) return index + 1;
  if (
    state.compat.requiresAssistantAfterToolResult &&
    state.lastRole === "toolResult" &&
    msg.role === "user"
  ) {
    state.params.push({ content: "I have processed the tool results.", role: "assistant" });
  }

  if (msg.role === "system") {
    convertSystemMessage({ index, msg, state });
  } else if (msg.role === "user") {
    if (!convertUserMessage({ msg, state })) return index + 1;
  } else if (msg.role === "assistant") {
    const assistantMsg = buildAssistantMessage({ msg, state });
    if (assistantMsg === undefined) return index + 1;
    state.params.push(assistantMsg);
  } else if (msg.role === "toolResult") {
    return convertToolResults({ index, messages, state });
  }
  state.lastRole = msg.role;
  return index + 1;
}

const convertMessages: {
  (
    context: transcriptTypes.TranscriptContext,
    compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat,
    options?: openaiCompletionsConvertStateTypes.ConvertCompletionsMessagesOptions,
  ): (model: typesModule.Model<"openai-completions">) => ChatCompletionMessageParam[];
  (
    model: typesModule.Model<"openai-completions">,
    context: transcriptTypes.TranscriptContext,
    compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat,
    options?: openaiCompletionsConvertStateTypes.ConvertCompletionsMessagesOptions,
  ): ChatCompletionMessageParam[];
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function (
    model: typesModule.Model<"openai-completions">,
    context: transcriptTypes.TranscriptContext,
    compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat,
    options?: openaiCompletionsConvertStateTypes.ConvertCompletionsMessagesOptions,
  ): ChatCompletionMessageParam[] {
    const normalizedContext = resolveTranscript(context, compat.supportsMidConvoSystemMessages);
    const transcriptTools = resolveTranscriptTools(
      normalizedContext.messages,
      compat.supportsMidConvoSystemMessages === true &&
        compat.supportsMidConvoToolAdditions === true,
    );
    const state: openaiCompletionsConvertStateTypes.ConvertState = {
      anchorsAdditions: transcriptTools.anchorsAdditions,
      compat,
      instructionRole: model.reasoning && compat.supportsDeveloperRole ? "developer" : "system",
      lastRole: null,
      model,
      options,
      params: [],
    };
    const transformedMessages = transformMessages(normalizedContext.messages, model, (id) =>
      normalizeToolCallId({ id, model }),
    );
    let index = 0;
    while (index < transformedMessages.length) {
      index = convertMessageAt(state, transformedMessages, index);
    }
    return state.params;
  },
);

const openaiCompletionsMessages = {
  convertMessages,
  hasToolHistory: openaiCompletionsConvertState.hasToolHistory,
};

export default openaiCompletionsMessages;
