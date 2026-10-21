import { Schema } from "effect";

const CostSchema = Schema.Struct({
  cacheRead: Schema.optional(Schema.Finite),
  cacheWrite: Schema.optional(Schema.Finite),
  input: Schema.optional(Schema.Finite),
  output: Schema.optional(Schema.Finite),
  total: Schema.optional(Schema.Finite),
});

const UsageSchema = Schema.Struct({
  cacheRead: Schema.optional(Schema.Finite),
  cacheWrite: Schema.optional(Schema.Finite),
  cost: Schema.optional(CostSchema),
  input: Schema.optional(Schema.Finite),
  output: Schema.optional(Schema.Finite),
  totalTokens: Schema.optional(Schema.Finite),
});

const MessageSchema = Schema.Struct({
  provider: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.Finite),
  usage: Schema.optional(UsageSchema),
});

const SessionEntrySchema = Schema.Struct({
  message: Schema.optional(MessageSchema),
  timestamp: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
});

const sessionsSchema = {
  CostSchema,
  SessionEntrySchema,
  UsageSchema,
};

export default sessionsSchema;
