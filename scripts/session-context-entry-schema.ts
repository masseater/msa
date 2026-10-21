import { Schema } from "effect";

const ContentBlock = Schema.Record(Schema.String, Schema.Unknown);

const UsageRecord = Schema.Record(Schema.String, Schema.Unknown);

const ContextEntrySchema = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  message: Schema.optional(
    Schema.Struct({
      content: Schema.optional(Schema.Union([Schema.String, Schema.Array(ContentBlock)])),
      model: Schema.optional(Schema.String),
      provider: Schema.optional(Schema.String),
      role: Schema.optional(Schema.String),
      usage: Schema.optional(UsageRecord),
    }),
  ),
  timestamp: Schema.optional(Schema.String),
  tokensBefore: Schema.optional(Schema.Finite),
  type: Schema.optional(Schema.String),
});

const sessionContextEntrySchema = {
  ContextEntrySchema,
  UsageRecord,
};

export default sessionContextEntrySchema;
