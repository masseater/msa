import { Function } from "effect";
import type { ResponseInput } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import openaiResponsesMessagesKit from "./openai-responses-messages-kit.ts";
import type openaiResponsesOptionsTypes from "./openai-responses-options.ts";
import openaiResponsesSystemInput from "./openai-responses-system-input.ts";
import type openaiResponsesSystemInputTypes from "./openai-responses-system-input.types.ts";
import openaiResponsesToolIds from "./openai-responses-tool-ids.ts";
import openaiResponsesUserInput from "./openai-responses-user-input.ts";
import transformMessagesModule from "./transform-messages.ts";

const { openaiResponsesAssistantInput, transcript } = openaiResponsesMessagesKit;

const { convertSystemMessage } = openaiResponsesSystemInput;
const { convertToolResultMessage, convertUserMessage } = openaiResponsesUserInput;
const { configurationUpdate, convertAssistantMessage } = openaiResponsesAssistantInput;
const { resolveTranscript, resolveTranscriptTools } = transcript;
const { responsesToolCallIdNormalizer } = openaiResponsesToolIds;
const { transformMessages } = transformMessagesModule;

function convertMessage<TApi extends typesModule.Api>(
  scope: openaiResponsesSystemInputTypes.ConversionScope<TApi>,
  message: typesModule.Message,
  position: openaiResponsesSystemInputTypes.Position,
): ResponseInput | undefined {
  const { model, options } = scope;
  switch (message.role) {
    case "system":
      return convertSystemMessage({ message, position, scope });
    case "user": {
      const item = convertUserMessage(message);
      return item === undefined ? undefined : [item];
    }
    case "assistant":
      return convertAssistantMessage({ message, model, msgIndex: position.msgIndex, options });
    case "toolResult": {
      const grammarToolInputProperties = options?.grammarToolInputProperties;
      return [convertToolResultMessage({ grammarToolInputProperties, message, model })];
    }
  }
}

function conversionScope<TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options: openaiResponsesOptionsTypes.ConvertResponsesMessagesOptions | undefined,
  messages: typesModule.Message[],
): openaiResponsesSystemInputTypes.ConversionScope<TApi> {
  const compat = model.compat as { supportsDeveloperRole?: boolean } | undefined;
  const announcesTools =
    (options?.supportsAdditionalTools ?? false) || (options?.supportsToolSearch ?? false);
  return {
    anchorsAdditions: resolveTranscriptTools(messages, announcesTools).anchorsAdditions,
    instructionRole:
      model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system",
    model,
    options,
  };
}

function convertMessages<TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  context: typesModule.TranscriptContext,
  allowedToolCallProviders: ReadonlySet<string>,
  options?: openaiResponsesOptionsTypes.ConvertResponsesMessagesOptions,
): ResponseInput {
  const normalized = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
  const scope = conversionScope(model, options, normalized.messages);
  const normalizeToolCallId = responsesToolCallIdNormalizer({ allowedToolCallProviders, model });
  const input: ResponseInput = [];
  let msgIndex = 0;
  for (const [sourceIndex, message] of transformMessages(
    normalized.messages,
    model,
    normalizeToolCallId,
  ).entries()) {
    const leading = sourceIndex === 0 && message.role === "system";
    const items = convertMessage(scope, message, { leading, msgIndex });
    if (items === undefined) continue;
    input.push(...items);
    if (!leading) msgIndex++;
  }
  if (options?.configurationUpdateEffort !== undefined) {
    input.push(configurationUpdate(options.configurationUpdateEffort));
  }
  return input;
}

const convertResponsesMessages: {
  <TApi extends typesModule.Api>(
    context: typesModule.TranscriptContext,
    allowedToolCallProviders: ReadonlySet<string>,
    options?: openaiResponsesOptionsTypes.ConvertResponsesMessagesOptions,
  ): (model: typesModule.Model<TApi>) => ResponseInput;
  <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.TranscriptContext,
    allowedToolCallProviders: ReadonlySet<string>,
    options?: openaiResponsesOptionsTypes.ConvertResponsesMessagesOptions,
  ): ResponseInput;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  convertMessages,
);

const openaiResponsesMessages = {
  convertResponsesMessages,
};

export default openaiResponsesMessages;
