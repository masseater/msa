import { Predicate, Schema } from "effect";

import type toolCallsTypes from "./tool-calls.types.ts";

const ContentBlock = Schema.Record(Schema.String, Schema.Unknown);

const callMessageFields = {
  api: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Union([Schema.String, Schema.Array(ContentBlock)])),
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
};

const toolCallEntrySchema = <const Fields extends Schema.Struct.Fields>(messageFields: Fields) =>
  Schema.Struct({
    id: Schema.optional(Schema.String),
    message: Schema.optional(Schema.Struct({ ...callMessageFields, ...messageFields })),
    timestamp: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String),
  });

const contentBlocks = (
  content: toolCallsTypes.CallMessage["content"],
): ReadonlyArray<toolCallsTypes.Block> => (Predicate.isString(content) ? [] : (content ?? []));

const toolCallsOf = (options: {
  readonly message: toolCallsTypes.CallMessage;
  readonly name: string;
}): ReadonlyArray<toolCallsTypes.Block> =>
  options.message.role === "assistant"
    ? contentBlocks(options.message.content).filter(
        (block) => block["type"] === "toolCall" && block["name"] === options.name,
      )
    : [];

const callOriginOf = (options: {
  readonly entry: { readonly id?: string | undefined; readonly timestamp?: string | undefined };
  readonly message: toolCallsTypes.CallMessage;
  readonly sessionFile: string;
}): toolCallsTypes.CallOrigin => {
  const { entry, message } = options;
  const provider = message.provider ?? "[unknown]";
  const model = message.model ?? "[unknown]";
  return {
    api: message.api ?? null,
    assistantEntryId: entry.id,
    model,
    provider,
    providerModel: `${provider}/${model}`,
    sessionFile: options.sessionFile,
    timestamp: entry.timestamp,
  };
};

const toolCallIdOf = (block: toolCallsTypes.Block): string =>
  Predicate.isString(block["id"]) ? block["id"] : "";

const toolCalls = {
  callOriginOf,
  contentBlocks,
  toolCallEntrySchema,
  toolCallIdOf,
  toolCallsOf,
};

export default toolCalls;
