import { Predicate, Schema } from "effect";

type Block = Readonly<Record<string, unknown>>;

interface CallMessage {
  readonly api?: string | undefined;
  readonly content?: string | ReadonlyArray<Block> | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly role?: string | undefined;
}

interface CallOrigin {
  readonly sessionFile: string;
  readonly assistantEntryId: string | undefined;
  readonly timestamp: string | undefined;
  readonly api: string | null;
  readonly provider: string;
  readonly model: string;
  readonly providerModel: string;
}

const ContentBlock = Schema.Record(Schema.String, Schema.Unknown);

const callMessageFields = {
  role: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Union([Schema.String, Schema.Array(ContentBlock)])),
};

const toolCallEntrySchema = <const Fields extends Schema.Struct.Fields>(messageFields: Fields) =>
  Schema.Struct({
    type: Schema.optional(Schema.String),
    id: Schema.optional(Schema.String),
    timestamp: Schema.optional(Schema.String),
    message: Schema.optional(Schema.Struct({ ...callMessageFields, ...messageFields })),
  });

const contentBlocks = (content: CallMessage["content"]): ReadonlyArray<Block> =>
  Predicate.isString(content) ? [] : (content ?? []);

const toolCallsOf = (options: {
  readonly message: CallMessage;
  readonly name: string;
}): ReadonlyArray<Block> =>
  options.message.role === "assistant"
    ? contentBlocks(options.message.content).filter(
        (block) => block["type"] === "toolCall" && block["name"] === options.name,
      )
    : [];

const callOriginOf = (options: {
  readonly entry: { readonly id?: string | undefined; readonly timestamp?: string | undefined };
  readonly message: CallMessage;
  readonly sessionFile: string;
}): CallOrigin => {
  const { entry, message } = options;
  const provider = message.provider ?? "[unknown]";
  const model = message.model ?? "[unknown]";
  return {
    sessionFile: options.sessionFile,
    assistantEntryId: entry.id,
    timestamp: entry.timestamp,
    api: message.api ?? null,
    provider,
    model,
    providerModel: `${provider}/${model}`,
  };
};

const toolCallIdOf = (block: Block): string => (Predicate.isString(block["id"]) ? block["id"] : "");

export type { Block, CallMessage, CallOrigin };
export { callOriginOf, contentBlocks, toolCallEntrySchema, toolCallIdOf, toolCallsOf };
