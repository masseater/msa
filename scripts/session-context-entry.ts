import { Predicate, Schema } from "effect";

import { toolCallsOf } from "./tool-calls.ts";
import type { Block } from "./tool-calls.ts";

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

const COMPONENT_TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

const usageNumber = (usage: ContextUsage, key: string): number => Number(usage[key] ?? 0);

const positiveFinite = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null;

const componentTokens = (usage: ContextUsage): number =>
  COMPONENT_TOKEN_KEYS.reduce((sum, key) => sum + usageNumber(usage, key), 0);

const contextTokens = (usage: ContextUsage | undefined): number | null =>
  usage === undefined
    ? null
    : (positiveFinite(usageNumber(usage, "totalTokens")) ?? positiveFinite(componentTokens(usage)));

const bashCommandOf = (block: Block): ReadonlyArray<string> => {
  const args = block["arguments"];
  const command = Predicate.hasProperty("command")(args) ? args.command : undefined;
  return Predicate.isString(command) && command !== "" ? [command] : [];
};

const bashCommandsOf = (message: ContextMessage): ReadonlyArray<string> =>
  toolCallsOf({ message, name: "bash" }).flatMap(bashCommandOf);

const providerModelOf = (message: ContextMessage): string =>
  `${message.provider ?? "[unknown]"}/${message.model ?? "[unknown]"}`;

export type { ContextEntry, ContextMessage, ContextUsage };
export { bashCommandsOf, contextTokens, decodeContextEntry, providerModelOf };
