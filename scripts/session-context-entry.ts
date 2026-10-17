import { Predicate, Schema } from "effect";

const ContentBlock = Schema.Record(Schema.String, Schema.Unknown);

const UsageRecord = Schema.Record(Schema.String, Schema.Unknown);

const ContextEntrySchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  tokensBefore: Schema.optional(Schema.Finite),
  message: Schema.optional(
    Schema.Struct({
      role: Schema.optional(Schema.String),
      provider: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      content: Schema.optional(Schema.Union([Schema.String, Schema.Array(ContentBlock)])),
      usage: Schema.optional(UsageRecord),
    }),
  ),
});

type ContextEntry = typeof ContextEntrySchema.Type;
type ContextMessage = NonNullable<ContextEntry["message"]>;
type ContextUsage = typeof UsageRecord.Type;

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(ContextEntrySchema));

const decodeContextEntry = (line: string) => decodeEntry(line);

const contextTokens = (usage: ContextUsage | undefined): number | null => {
  if (usage === undefined) return null;
  const totalTokens = Number(usage.totalTokens ?? 0);
  if (Number.isFinite(totalTokens) && totalTokens > 0) return totalTokens;
  const value =
    Number(usage.input ?? 0) +
    Number(usage.output ?? 0) +
    Number(usage.cacheRead ?? 0) +
    Number(usage.cacheWrite ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const bashCommandsOf = (content: ContextMessage["content"]): ReadonlyArray<string> => {
  if (content === undefined || Predicate.isString(content)) return [];
  return content.flatMap((block) => {
    if (block.type !== "toolCall" || block.name !== "bash") return [];
    const args = block.arguments;
    const command = Predicate.hasProperty("command")(args) ? args.command : undefined;
    return Predicate.isString(command) && command !== "" ? [command] : [];
  });
};

export type { ContextEntry, ContextMessage, ContextUsage };
export { bashCommandsOf, contextTokens, decodeContextEntry };
