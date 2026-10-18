import { Function } from "effect";
import type { ResponseInput } from "openai/resources/responses/responses.js";

import type { Api, Message, Model, TranscriptContext } from "../types.ts";
import { resolveTranscript, resolveTranscriptTools } from "../utils/transcript.ts";
import {
  configurationUpdate,
  convertAssistantMessage,
} from "./openai-responses-assistant-input.ts";
import type { ConvertResponsesMessagesOptions } from "./openai-responses-options.ts";
import {
  type ConversionScope,
  convertSystemMessage,
  type Position,
} from "./openai-responses-system-input.ts";
import { responsesToolCallIdNormalizer } from "./openai-responses-tool-ids.ts";
import { convertToolResultMessage, convertUserMessage } from "./openai-responses-user-input.ts";
import { transformMessages } from "./transform-messages.ts";

function convertMessage<TApi extends Api>(
  scope: ConversionScope<TApi>,
  message: Message,
  position: Position,
): ResponseInput | undefined {
  const { model, options } = scope;
  switch (message.role) {
    case "system":
      return convertSystemMessage({ scope, message, position });
    case "user": {
      const item = convertUserMessage(message);
      return item === undefined ? undefined : [item];
    }
    case "assistant":
      return convertAssistantMessage({ model, message, msgIndex: position.msgIndex, options });
    case "toolResult": {
      const grammarToolInputProperties = options?.grammarToolInputProperties;
      return [convertToolResultMessage({ model, message, grammarToolInputProperties })];
    }
  }
}

function conversionScope<TApi extends Api>(
  model: Model<TApi>,
  options: ConvertResponsesMessagesOptions | undefined,
  messages: Message[],
): ConversionScope<TApi> {
  const compat = model.compat as { supportsDeveloperRole?: boolean } | undefined;
  const announcesTools =
    (options?.supportsAdditionalTools ?? false) || (options?.supportsToolSearch ?? false);
  return {
    model,
    options,
    instructionRole:
      model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system",
    anchorsAdditions: resolveTranscriptTools(messages, announcesTools).anchorsAdditions,
  };
}

function convertMessages<TApi extends Api>(
  model: Model<TApi>,
  context: TranscriptContext,
  allowedToolCallProviders: ReadonlySet<string>,
  options?: ConvertResponsesMessagesOptions,
): ResponseInput {
  const normalized = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
  const scope = conversionScope(model, options, normalized.messages);
  const normalizeToolCallId = responsesToolCallIdNormalizer({ model, allowedToolCallProviders });
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

export const convertResponsesMessages: {
  <TApi extends Api>(
    context: TranscriptContext,
    allowedToolCallProviders: ReadonlySet<string>,
    options?: ConvertResponsesMessagesOptions,
  ): (model: Model<TApi>) => ResponseInput;
  <TApi extends Api>(
    model: Model<TApi>,
    context: TranscriptContext,
    allowedToolCallProviders: ReadonlySet<string>,
    options?: ConvertResponsesMessagesOptions,
  ): ResponseInput;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  convertMessages,
);
